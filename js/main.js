// --- 1. Inisialisasi Koneksi ke Supabase ---
const SUPABASE_URL = 'https://eevlafxgxplfjfpcbghc.supabase.co'; // Ganti dengan URL project Anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldmxhZnhneHBsZmpmcGNiZ2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTI2NjEsImV4cCI6MjA5MDQyODY2MX0.8lkUZBkl8zFRwxWcmF-v4q8OD4eQ4ld4mbwUBl0Kr3Q'; // Ganti dengan Anon Key Anda
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 2. Fungsi untuk Mengelola Komentar ---

// Mendapatkan semua komentar (dengan child comment / reply)
async function fetchComments() {
    const { data, error } = await supabase
        .from('comments')
        .select('*, children:comments!parent_id(*)')
        .is('parent_id', null) // Ambil hanya komentar utama (bukan reply)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

// Menambahkan komentar atau reply baru
async function addComment({ parentId, name, presence, comment, gifUrl }) {
    const session = await supabase.auth.getSession();
    const isAdmin = !!session.data.session;

    const newComment = {
        parent_id: parentId || null,
        name: name,
        presence: presence,
        comment: comment || null,
        gif_url: gifUrl || null,
        is_admin: isAdmin,
        user_id: isAdmin ? session.data.session.user.id : null,
    };

    const { data, error } = await supabase
        .from('comments')
        .insert(newComment)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// Memperbarui komentar
async function updateComment(commentId, updates) {
    const { error } = await supabase
        .from('comments')
        .update(updates)
        .eq('id', commentId);

    if (error) throw error;
}

// Menghapus komentar
async function deleteComment(commentId) {
    const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId);

    if (error) throw error;
}

// Menambah/Mengurangi like
async function toggleLike(commentId, increment = true) {
    const { data: comment } = await supabase
        .from('comments')
        .select('like_count')
        .eq('id', commentId)
        .single();

    const newLikeCount = comment.like_count + (increment ? 1 : -1);
    const { error } = await supabase
        .from('comments')
        .update({ like_count: newLikeCount })
        .eq('id', commentId);

    if (error) throw error;
}

// --- 3. Fungsi untuk Autentikasi Admin ---

// Login Admin
async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

// Logout Admin
async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

// Mendapatkan data user yang sedang login
async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
}

// --- 4. Mendengarkan Perubahan Data Secara Real-time ---

// Fungsi untuk subscribe ke perubahan di tabel 'comments'
function subscribeToComments(callback) {
    const subscription = supabase
        .channel('comments-channel')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'comments' }, 
            payload => callback(payload)
        )
        .subscribe();

    return subscription;
}