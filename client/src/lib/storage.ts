const PLAYER_ID_KEY = 'boggle.playerId';
const NICKNAME_KEY = 'boggle.nickname';

/** Identité stable du joueur : permet de retrouver ses mots et son score après une coupure. */
export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id || id.length < 8) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function setNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname);
}
