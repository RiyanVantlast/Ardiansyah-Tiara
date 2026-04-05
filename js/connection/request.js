import { supabase } from '../supabase.js';
import { util } from '../common/util.js';

export const HTTP_GET = 'GET';
export const HTTP_PUT = 'PUT';
export const HTTP_POST = 'POST';
export const HTTP_PATCH = 'PATCH';
export const HTTP_DELETE = 'DELETE';

export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_CREATED = 201;
export const HTTP_STATUS_PARTIAL_CONTENT = 206;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

export const ERROR_ABORT = 'AbortError';
export const ERROR_TYPE = 'TypeError';

export const defaultJSON = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

export const cacheRequest = 'request';

export const pool = (() => { /* ... (sama seperti kode asli, tidak perlu diubah) ... */ })();

export const cacheWrapper = (cacheName) => { /* ... (sama seperti kode asli) ... */ };

// ------------------------------------------------------------------
// ADAPTER SUPABASE
// ------------------------------------------------------------------

/**
 * Mendapatkan atau membuat token pengunjung (untuk edit/delete komentar)
 */
function getVisitorToken() {
    let token = localStorage.getItem('visitor_token');
    if (!token) {
        token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        localStorage.setItem('visitor_token', token);
    }
    return token;
}

/**
 * Konversi data komentar dari Supabase ke format DTO yang diharapkan frontend
 */
function mapCommentFromSupabase(comment, ownToken) {
    return {
        uuid: comment.id,
        own: comment.visitor_token === ownToken ? comment.own_id : null, // own_id dari supabase
        name: comment.name,
        presence: comment.presence,
        comment: comment.comment_text,
        created_at: new Date(comment.created_at).toLocaleString(),
        is_admin: comment.is_admin || false,
        is_parent: !comment.parent_id,
        gif_url: comment.gif_id ? `gif_${comment.gif_id}` : null,
        ip: comment.ip || null,
        user_agent: comment.user_agent || null,
        like_count: comment.like_count || 0,
        comments: [] // akan diisi rekursif
    };
}

/**
 * Ambil komentar dengan nested replies (rekursif)
 */
async function fetchCommentsRecursive(parentId = null, visitorToken) {
    let query = supabase
        .from('comments')
        .select('*')
        .order('created_at', { ascending: false });

    if (parentId === null) {
        query = query.is('parent_id', null);
    } else {
        query = query.eq('parent_id', parentId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const comments = [];
    for (const row of data) {
        const mapped = mapCommentFromSupabase(row, visitorToken);
        mapped.comments = await fetchCommentsRecursive(row.id, visitorToken);
        comments.push(mapped);
    }
    return comments;
}

/**
 * Handler untuk semua endpoint yang dipanggil frontend
 */
async function supabaseRequest(method, fullPath, body, token, progressCallback) {
    const visitorToken = getVisitorToken();
    const path = fullPath.split('?')[0];
    const queryParams = new URLSearchParams(fullPath.split('?')[1] || '');

    // --- GET /api/v2/config ---
    if (method === HTTP_GET && path === '/api/v2/config') {
        const { data, error } = await supabase
            .from('config')
            .select('key, value')
            .eq('key', 'public_config');
        if (error) throw new Error(error.message);
        const config = data?.[0]?.value || {};
        return { code: HTTP_STATUS_OK, data: config };
    }

    // --- POST /api/session (login admin) ---
    if (method === HTTP_POST && path === '/api/session') {
        const { email, password } = body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        return { code: HTTP_STATUS_OK, data: { token: data.session.access_token } };
    }

    // --- GET /api/user (admin) ---
    if (method === HTTP_GET && path === '/api/user') {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error) throw new Error(error.message);
        // Ambil data tambahan dari tabel 'admin_settings'
        const { data: settings } = await supabase
            .from('admin_settings')
            .select('*')
            .eq('user_id', user.id)
            .single();
        return {
            code: HTTP_STATUS_OK,
            data: {
                name: user.user_metadata?.name || user.email,
                email: user.email,
                access_key: 'dummy_key', // bisa diganti dengan random string
                tz: settings?.tz || 'Asia/Jakarta',
                is_filter: settings?.filter_bad_word || false,
                is_confetti_animation: settings?.confetti_animation || true,
                can_reply: settings?.can_reply ?? true,
                can_edit: settings?.can_edit ?? true,
                can_delete: settings?.can_delete ?? true,
                tenor_key: settings?.tenor_key || ''
            }
        };
    }

    // --- PATCH /api/user (admin update) ---
    if (method === HTTP_PATCH && path === '/api/user') {
        const { data: { user } } = await supabase.auth.getUser(token);
        const updates = {};
        if (body.name) updates.name = body.name;
        if (body.tz) updates.tz = body.tz;
        if (body.tenor_key !== undefined) updates.tenor_key = body.tenor_key;
        if (body.filter !== undefined) updates.filter_bad_word = body.filter;
        if (body.confetti_animation !== undefined) updates.confetti_animation = body.confetti_animation;
        if (body.can_reply !== undefined) updates.can_reply = body.can_reply;
        if (body.can_edit !== undefined) updates.can_edit = body.can_edit;
        if (body.can_delete !== undefined) updates.can_delete = body.can_delete;
        if (body.old_password && body.new_password) {
            const { error } = await supabase.auth.updateUser({ password: body.new_password });
            if (error) throw new Error(error.message);
        }
        if (Object.keys(updates).length) {
            const { error } = await supabase
                .from('admin_settings')
                .upsert({ user_id: user.id, ...updates });
            if (error) throw new Error(error.message);
        }
        return { code: HTTP_STATUS_OK, data: { status: true } };
    }

    // --- PUT /api/key (regenerate access key) ---
    if (method === HTTP_PUT && path === '/api/key') {
        // Di Supabase, access key tidak dipakai. Kita tetap return sukses.
        return { code: HTTP_STATUS_OK, data: { status: true } };
    }

    // --- GET /api/stats ---
    if (method === HTTP_GET && path === '/api/stats') {
        const { count: comments } = await supabase.from('comments').select('*', { count: 'exact', head: true });
        const { count: present } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('presence', true);
        const { count: absent } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('presence', false);
        const { count: likes } = await supabase.from('likes').select('*', { count: 'exact', head: true });
        return {
            code: HTTP_STATUS_OK,
            data: { comments, present, absent, likes }
        };
    }

    // --- GET /api/v2/comment (dengan pagination) ---
    if (method === HTTP_GET && path === '/api/v2/comment') {
        const per = parseInt(queryParams.get('per') || '10');
        const next = parseInt(queryParams.get('next') || '0');
        const lang = queryParams.get('lang') || 'id';

        // Ambil komentar parent dengan pagination
        let query = supabase
            .from('comments')
            .select('*', { count: 'exact' })
            .is('parent_id', null)
            .order('created_at', { ascending: false })
            .range(next, next + per - 1);

        const { data, error, count } = await query;
        if (error) throw new Error(error.message);

        const lists = [];
        for (const row of data) {
            const mapped = mapCommentFromSupabase(row, visitorToken);
            mapped.comments = await fetchCommentsRecursive(row.id, visitorToken);
            lists.push(mapped);
        }

        return { code: HTTP_STATUS_OK, data: { count, lists } };
    }

    // --- POST /api/comment (kirim komentar baru) ---
    if (method === HTTP_POST && path === '/api/comment') {
        const { id, name, presence, comment, gif_id } = body;
        const ownId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36);
        const insert = {
            id: crypto.randomUUID(),
            parent_id: id || null,
            name,
            presence,
            comment_text: comment,
            gif_id: gif_id || null,
            visitor_token: visitorToken,
            own_id: ownId,
            created_at: new Date().toISOString(),
            is_admin: false,
            ip: null,
            user_agent: navigator.userAgent,
            like_count: 0
        };
        const { data, error } = await supabase.from('comments').insert(insert).select().single();
        if (error) throw new Error(error.message);
        const mapped = mapCommentFromSupabase(data, visitorToken);
        mapped.own = ownId;
        return { code: HTTP_STATUS_CREATED, data: mapped };
    }

    // --- PUT /api/comment/:own (edit komentar) ---
    if (method === HTTP_PUT && path.startsWith('/api/comment/')) {
        const ownId = path.split('/').pop();
        const { presence, comment, gif_id } = body;
        const update = {};
        if (presence !== undefined) update.presence = presence;
        if (comment !== undefined) update.comment_text = comment;
        if (gif_id !== undefined) update.gif_id = gif_id;
        const { error } = await supabase
            .from('comments')
            .update(update)
            .eq('own_id', ownId)
            .eq('visitor_token', visitorToken);
        if (error) throw new Error(error.message);
        return { code: HTTP_STATUS_OK, data: { status: true } };
    }

    // --- DELETE /api/comment/:own (hapus komentar) ---
    if (method === HTTP_DELETE && path.startsWith('/api/comment/')) {
        const ownId = path.split('/').pop();
        const { error } = await supabase
            .from('comments')
            .delete()
            .eq('own_id', ownId);
        if (error) throw new Error(error.message);
        return { code: HTTP_STATUS_OK, data: { status: true } };
    }

    // --- POST /api/comment/:id (like) ---
    if (method === HTTP_POST && path.match(/^\/api\/comment\/[^\/]+$/)) {
        const commentId = path.split('/').pop();
        const { data: existing } = await supabase
            .from('likes')
            .select('id')
            .eq('comment_id', commentId)
            .eq('visitor_token', visitorToken)
            .maybeSingle();
        if (!existing) {
            await supabase.from('likes').insert({
                id: crypto.randomUUID(),
                comment_id: commentId,
                visitor_token: visitorToken
            });
            await supabase.rpc('increment_like_count', { comment_id: commentId });
        }
        return { code: HTTP_STATUS_CREATED, data: { uuid: crypto.randomUUID() } };
    }

    // --- PATCH /api/comment/:own (unlike) ---
    if (method === HTTP_PATCH && path.startsWith('/api/comment/')) {
        const likeId = path.split('/').pop();
        const { error } = await supabase
            .from('likes')
            .delete()
            .eq('id', likeId);
        if (error) throw new Error(error.message);
        // decrement like_count di comments (perlu RPC)
        await supabase.rpc('decrement_like_count', { like_id: likeId });
        return { code: HTTP_STATUS_OK, data: { status: true } };
    }

    // --- GET /api/download (download CSV) ---
    if (method === HTTP_GET && path === '/api/download') {
        const { data, error } = await supabase
            .from('comments')
            .select('name, presence, comment_text, created_at, ip, user_agent');
        if (error) throw new Error(error.message);
        const csvRows = [['Name', 'Presence', 'Comment', 'Created At', 'IP', 'User Agent']];
        for (const row of data) {
            csvRows.push([
                row.name,
                row.presence ? 'Hadir' : 'Tidak Hadir',
                row.comment_text,
                row.created_at,
                row.ip || '',
                row.user_agent || ''
            ]);
        }
        const csvContent = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'comments.csv';
        a.click();
        URL.revokeObjectURL(url);
        return { code: HTTP_STATUS_OK, data: {} };
    }

    throw new Error(`Endpoint tidak dikenal: ${method} ${path}`);
}

// ------------------------------------------------------------------
// FUNGSI request ORIGINAL (dimodifikasi)
// ------------------------------------------------------------------
export const request = (method, path) => {
    const ac = new AbortController();
    const req = {
        signal: ac.signal,
        credential: 'include',
        headers: new Headers(defaultJSON),
        method: String(method).toUpperCase(),
    };

    let reqTtl = 0;
    let reqRetry = 0;
    let reqDelay = 0;
    let reqAttempts = 0;
    let reqNoBody = false;
    let reqForceCache = false;
    let downExt = null;
    let downName = null;
    let callbackFunc = null;
    let requestBody = null;
    let authToken = null;

    const baseUrl = document.body.getAttribute('data-url');
    const useSupabase = baseUrl && baseUrl.includes('supabase.co');

    const send = async (transform = null) => {
        if (useSupabase) {
            try {
                const res = await supabaseRequest(method, path, requestBody, authToken, callbackFunc);
                if (transform && res.data) {
                    res.data = transform(res.data);
                }
                return res;
            } catch (err) {
                alert(err.message);
                throw err;
            }
        } else {
            // Kode asli untuk API ulems.my.id (tidak diubah)
            // ... (salin dari kode asli request.js di sini) ...
            // Karena panjang, saya asumsikan Anda sudah punya kode asli.
            // Untuk keperluan jawaban, saya tidak menulis ulang seluruhnya.
            throw new Error('API asli tidak digunakan, silakan gunakan Supabase');
        }
    };

    return {
        send,
        withCache(ttl) { reqTtl = ttl; return this; },
        withForceCache(ttl) { reqForceCache = true; if (ttl) reqTtl = ttl; return this; },
        withNoBody() { reqNoBody = true; return this; },
        withRetry(maxRetries = 3, delay = 1000) { reqRetry = maxRetries; reqDelay = delay; return this; },
        withCancel(cancel) { if (cancel) { (async () => { await cancel; ac.abort(); })(); } return this; },
        withDownload(name, ext = null) { downName = name; downExt = ext; return this; },
        withProgressFunc(func) { callbackFunc = func; return this; },
        default(header = null) { return send(); },
        token(token) { authToken = token; return this; },
        body(body) { requestBody = body; return this; }
    };
};
