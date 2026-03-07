import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import type { LoginPayload } from '@/types/auth';

export function useLogin() {
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      await login(payload);
    },
  });
}
