// supabase.js
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// Helper untuk mendapatkan session token
async function getSessionToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

// Fungsi login dengan email/password
async function loginWithEmail(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session.access_token;
}

// Fungsi logout
async function logout() {
  await supabaseClient.auth.signOut();
}

// Cek apakah user sudah login dan token valid
async function isAuthenticated() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return !!session;
}

// Mendapatkan data user dari tabel public.users
async function getUserProfile() {
  const { data, error } = await supabaseClient
    .from('users')
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Update user profile
async function updateUserProfile(updates) {
  const { data, error } = await supabaseClient
    .from('users')
    .update(updates)
    .eq('id', (await supabaseClient.auth.getUser()).data.user.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Mengambil config berdasarkan key
async function getConfig(key) {
  const { data, error } = await supabaseClient
    .from('config')
    .select('value')
    .eq('key', key)
    .single();
  if (error) return null;
  return data.value;
}

// Mendapatkan semua config (untuk keperluan awal)
async function getAllConfig() {
  const { data, error } = await supabaseClient.from('config').select('*');
  if (error) throw new Error(error.message);
  const configMap = {};
  data.forEach(item => { configMap[item.key] = item.value; });
  return configMap;
}

// CRUD Comments dengan pagination
async function getComments(limit, offset, lang = 'en') {
  // Lang tidak digunakan di sini, bisa disesuaikan
  let query = supabaseClient
    .from('comments')
    .select('*, likes:likes(count)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  
  // Format like_count
  const formatted = data.map(c => ({
    ...c,
    like_count: c.likes[0]?.count || 0,
    likes: undefined
  }));
  return { lists: formatted, count };
}

// Insert comment
async function insertComment(commentData) {
  const { data, error } = await supabaseClient
    .from('comments')
    .insert(commentData)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Update comment
async function updateComment(uuid, updates) {
  const { data, error } = await supabaseClient
    .from('comments')
    .update(updates)
    .eq('uuid', uuid)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Delete comment
async function deleteComment(uuid) {
  const { error } = await supabaseClient
    .from('comments')
    .delete()
    .eq('uuid', uuid);
  if (error) throw new Error(error.message);
  return true;
}

// Like / Unlike comment
async function toggleLike(commentUuid) {
  const user = (await supabaseClient.auth.getUser()).data.user;
  if (!user) throw new Error('Not authenticated');
  
  // Cek apakah sudah like
  const { data: existing } = await supabaseClient
    .from('likes')
    .select('id')
    .eq('comment_uuid', commentUuid)
    .eq('user_id', user.id)
    .single();
  
  if (existing) {
    // Unlike
    const { error } = await supabaseClient
      .from('likes')
      .delete()
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return { status: false };
  } else {
    // Like
    const { error } = await supabaseClient
      .from('likes')
      .insert({ comment_uuid: commentUuid, user_id: user.id });
    if (error) throw new Error(error.message);
    return { status: true };
  }
}

// Stats
async function getStats() {
  const { data: comments, error: err1 } = await supabaseClient
    .from('comments')
    .select('id', { count: 'exact', head: true });
  const { data: present, error: err2 } = await supabaseClient
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('presence', true);
  const { data: absent, error: err3 } = await supabaseClient
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('presence', false);
  const { data: likes, error: err4 } = await supabaseClient
    .from('likes')
    .select('id', { count: 'exact', head: true });
  
  if (err1 || err2 || err3 || err4) throw new Error('Failed to fetch stats');
  return {
    comments: comments || 0,
    present: present || 0,
    absent: absent || 0,
    likes: likes || 0
  };
}

// Download CSV (semua comments)
async function downloadCommentsCSV() {
  const { data, error } = await supabaseClient
    .from('comments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  // Konversi ke CSV
  const headers = ['uuid', 'name', 'presence', 'comment', 'gif_url', 'created_at', 'ip', 'user_agent'];
  const rows = data.map(c => [
    c.uuid, c.name, c.presence, c.comment, c.gif_url, c.created_at, c.ip, c.user_agent
  ]);
  const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `comments_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Regenerate access key (update kolom access_key di users)
async function regenerateAccessKey() {
  const newKey = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36);
  const { error } = await supabaseClient
    .from('users')
    .update({ access_key: newKey })
    .eq('id', (await supabaseClient.auth.getUser()).data.user.id);
  if (error) throw new Error(error.message);
  return newKey;
}

// Export semua fungsi
window.supabaseAPI = {
  loginWithEmail,
  logout,
  isAuthenticated,
  getUserProfile,
  updateUserProfile,
  getConfig,
  getAllConfig,
  getComments,
  insertComment,
  updateComment,
  deleteComment,
  toggleLike,
  getStats,
  downloadCommentsCSV,
  regenerateAccessKey,
  getSessionToken,
  supabase: supabaseClient
};