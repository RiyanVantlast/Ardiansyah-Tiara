import { supabase } from '../supabase.js';

export const session = (() => {
    let ses = null;

    const getToken = () => ses.get('token');
    const setToken = (token) => ses.set('token', token);
    const logout = () => ses.unset('token');

    const isAdmin = () => {
        const token = getToken();
        if (!token) return false;
        // Cek apakah token adalah JWT (punya 3 bagian)
        return token.split('.').length === 3;
    };

    const isValid = async () => {
        const token = getToken();
        if (!token) return false;
        const { data: { user }, error } = await supabase.auth.getUser(token);
        return !error && !!user;
    };

    const guest = async (token) => {
        setToken(token);
        // Ambil config dari Supabase (sudah di-handle oleh request.js)
        const { request } = await import('../connection/request.js');
        const res = await request(HTTP_GET, '/api/v2/config').token(token).send();
        return res;
    };

    const init = () => {
        ses = storage('session');
    };

    return { init, guest, isValid, login, logout, isAdmin, setToken, getToken };
})();
