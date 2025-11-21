import { signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { emit } from './events.js';

export function getFirebaseErrorMessage(error) {
    switch (error.code) {
        case 'auth/invalid-credential': return 'Email ou palavra-passe incorretos.';
        case 'auth/user-not-found': return 'Utilizador não encontrado.';
        case 'auth/wrong-password': return 'Palavra-passe incorreta.';
        case 'auth/email-already-in-use': return 'Este email já está a ser utilizado.';
        case 'auth/weak-password': return 'A palavra-passe é demasiado fraca (mínimo 6 caracteres).';
        case 'auth/invalid-email': return 'O formato do email é inválido.';
        default: console.error(error); return 'Ocorreu um erro. Por favor, tente novamente.';
    }
}

export async function logout(auth) {
    try {
        await signOut(auth);
        emit('auth:logout_success');
    } catch (error) {
        emit('error:auth', {
            message: 'Ocorreu um erro ao terminar a sessão.',
            source: 'logout',
            originalError: error
        });
    }
}
