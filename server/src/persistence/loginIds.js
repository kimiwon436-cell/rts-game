import { loginIdToEmail } from '@rune/shared/rules/loginId.js';
import { getAdminAuth, getProjectId } from '../firebase.js';

/**
 * 가입 화면의 아이디 중복 확인.
 * 아이디는 Firebase에 내부 주소(아이디@id.<프로젝트>.firebaseapp.com)로 저장되므로 그 주소의 계정이 있는지 본다.
 * 실제 중복은 가입할 때 Firebase가 다시 막는다 (auth/email-already-in-use).
 *
 * @returns {{ isAvailable: (loginId: string) => Promise<boolean | null> }} null이면 이 서버는 알 수 없다 (개발 모드)
 */
export function createLoginIdLookup() {
  const auth = getAdminAuth();
  const projectId = getProjectId();
  if (!auth || !projectId) return { isAvailable: async () => null };
  return {
    async isAvailable(loginId) {
      try {
        await auth.getUserByEmail(loginIdToEmail(loginId, projectId));
        return false;
      } catch (err) {
        if (err.code === 'auth/user-not-found') return true;
        throw err;
      }
    },
  };
}
