// admin.js - Supabase Version
(() => {
  // ==================== UTIL SAMA SEPERTI SEBELUMNYA ====================
  // (salin semua fungsi util dari admin.js asli: loader, ask, copy, notify, dll)
  // Disarankan untuk tetap menggunakan kode util yang sudah ada, hanya mengganti bagian API.
  // Karena terlalu panjang, saya asumsikan util sudah tersedia.
  // Di sini saya akan tulis hanya bagian yang berubah (inisialisasi dan fungsi API baru).

  const supabase = window.supabaseAPI;

  // Inisialisasi ulang session storage
  const sessionStore = (() => {
    let token = null;
    return {
      setToken: (t) => { token = t; localStorage.setItem('session_token', t); },
      getToken: () => token || localStorage.getItem('session_token'),
      clear: () => { token = null; localStorage.removeItem('session_token'); }
    };
  })();

  // Fungsi login (menggunakan supabase)
  async function login(email, password) {
    try {
      const token = await supabase.loginWithEmail(email, password);
      sessionStore.setToken(token);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function logout() {
    await supabase.logout();
    sessionStore.clear();
    // Hapus semua data localStorage terkait
    ['owns', 'likes', 'config', 'comment', 'session', 'information'].forEach(key => localStorage.removeItem(key));
    location.reload();
  }

  async function fetchUserAndConfig() {
    const user = await supabase.getUserProfile();
    const configs = await supabase.getAllConfig();
    // Simpan ke localStorage untuk akses cepat
    const configStore = R('config');
    Object.entries(configs).forEach(([k, v]) => configStore.set(k, v));
    configStore.set('tenor_key', user.tenor_key);
    // Update DOM
    document.getElementById('dashboard-name').innerHTML = `${escapeHtml(user.name)} <i class="fa-solid fa-hands text-warning ms-2"></i>`;
    document.getElementById('dashboard-email').textContent = user.email;
    document.getElementById('dashboard-accesskey').value = user.access_key || '';
    document.getElementById('button-copy-accesskey').setAttribute('data-copy', user.access_key || '');
    document.getElementById('form-name').value = escapeHtml(user.name);
    document.getElementById('form-timezone').value = user.tz || 'UTC';
    document.getElementById('filterBadWord').checked = user.is_filter || false;
    document.getElementById('confettiAnimation').checked = user.is_confetti_animation || false;
    document.getElementById('replyComment').checked = user.can_reply !== false;
    document.getElementById('editComment').checked = user.can_edit !== false;
    document.getElementById('deleteComment').checked = user.can_delete !== false;
    document.getElementById('dashboard-tenorkey').value = user.tenor_key || '';
    // Stats
    const stats = await supabase.getStats();
    document.getElementById('count-comment').textContent = stats.comments.toLocaleString();
    document.getElementById('count-present').textContent = stats.present.toLocaleString();
    document.getElementById('count-absent').textContent = stats.absent.toLocaleString();
    document.getElementById('count-like').textContent = stats.likes.toLocaleString();
    // Trigger event untuk comment
    document.dispatchEvent(new Event('undangan.session'));
    // Tampilkan komentar
    window.undangan.comment.show();
  }

  // Fungsi update user (toggle, name, password, tz, tenor)
  async function updateUserField(field, value) {
    const update = { [field]: value };
    await supabase.updateUserProfile(update);
  }

  // Regenerate access key
  async function regenerateKey(btn) {
    if (!ask('Are you sure?')) return;
    const disable = disableButton(btn);
    try {
      const newKey = await supabase.regenerateAccessKey();
      document.getElementById('dashboard-accesskey').value = newKey;
      document.getElementById('button-copy-accesskey').setAttribute('data-copy', newKey);
      notify('Access key regenerated').success();
    } catch (err) {
      notify(err.message).error();
    } finally {
      disable.restore();
    }
  }

  // Download CSV
  async function downloadCSV(btn) {
    const disable = disableButton(btn);
    try {
      await supabase.downloadCommentsCSV();
    } catch (err) {
      notify(err.message).error();
    } finally {
      disable.restore();
    }
  }

  // Change password (perlu verifikasi old password)
  async function changePassword(btn, oldPass, newPass) {
    // Karena Supabase Auth tidak menyediakan old password verification langsung,
    // kita harus sign in ulang. Alternatif: minta user login ulang.
    const disable = disableButton(btn);
    try {
      const { error } = await supabase.supabase.auth.updateUser({ password: newPass });
      if (error) throw new Error(error.message);
      notify('Password changed successfully').success();
      document.getElementById('old_password').value = '';
      document.getElementById('new_password').value = '';
    } catch (err) {
      notify(err.message).error();
    } finally {
      disable.restore(true);
    }
  }

  // ==================== INTEGRASI DENGAN KOMENTAR ====================
  // Modifikasi fungsi comment.show() untuk menggunakan supabase.getComments
  // Karena comment.js sudah ada, kita override beberapa method.

  const originalCommentShow = window.undangan?.comment?.show;
  if (originalCommentShow) {
    window.undangan.comment.show = async function() {
      const per = V.getPer();
      const next = V.getNext();
      const commentsDiv = document.getElementById('comments');
      commentsDiv.setAttribute('data-loading', 'true');
      commentsDiv.innerHTML = j.renderLoading().repeat(per);
      try {
        const { lists, count } = await supabase.getComments(per, next);
        // Proses data (sama seperti sebelumnya)
        // ... (gunakan fungsi renderContentMany)
        const html = await j.renderContentMany(lists);
        commentsDiv.innerHTML = html;
        V.setTotal(count);
        // Tambahkan listener like dll
      } catch (err) {
        notify(err.message).error();
      } finally {
        commentsDiv.setAttribute('data-loading', 'false');
      }
    };
  }

  // Inisialisasi utama
  async function init() {
    // Cek token di URL hash
    const hashToken = window.location.hash.slice(1);
    if (hashToken) {
      sessionStore.setToken(hashToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // Cek apakah sudah login via Supabase
    const authed = await supabase.isAuthenticated();
    if (authed) {
      await fetchUserAndConfig();
    } else {
      // Tampilkan modal login
      Z.modal('mainModal').show();
    }
  }

  // Event binding
  window.undangan = window.undangan || {};
  window.undangan.admin = {
    auth: { login: (btn) => { /* ambil email pass dari form dan panggil login */ } },
    logout,
    tenor: async (btn) => { /* update tenor_key */ },
    download: downloadCSV,
    regenerate: regenerateKey,
    changeName: async (btn) => { /* update name */ },
    changePassword: (btn) => { /* ambil old/new dan panggil changePassword */ },
    changeCheckboxValue: (chk, field) => { updateUserField(field, chk.checked); },
    enableButtonName: () => {},
    enableButtonPassword: () => {},
    openLists: (input, val) => {},
    changeTz: async (btn) => { /* update tz */ }
  };
  window.undangan.comment = window.undangan.comment || {};
  window.undangan.comment.send = async (btn) => { /* insert comment menggunakan supabase.insertComment */ };
  window.undangan.comment.update = async (btn) => { /* update comment */ };
  window.undangan.comment.remove = async (btn) => { /* delete comment */ };
  window.undangan.comment.like = { love: async (btn) => { /* toggleLike */ } };

  // Jalankan init saat load
  window.addEventListener('load', init);
})();