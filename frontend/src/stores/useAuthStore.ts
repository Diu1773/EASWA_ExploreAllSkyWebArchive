import { create } from 'zustand';
import { fetchCurrentUser, logout as apiLogout, type AuthUser } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  checkSession: async () => {
    set({ loading: true });
    const user = await fetchCurrentUser();
    set({ user, loading: false });
  },

  logout: async () => {
    await apiLogout();
    set({ user: null });
  },
}));
