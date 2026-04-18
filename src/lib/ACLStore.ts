const ACL_STORAGE_KEY = "nostr_docs_acl";

export type ACLRole = "view" | "edit";

export interface ACLRecord {
  npub: string;
  role: ACLRole;
  timestamp: number;
}

export interface ACLState {
  [documentAddress: string]: ACLRecord[];
}

export function loadACL(): ACLState {
  try {
    const raw = localStorage.getItem(ACL_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveACL(state: ACLState) {
  localStorage.setItem(ACL_STORAGE_KEY, JSON.stringify(state));
}

export function addACLRecord(address: string, npub: string, role: ACLRole) {
  const state = loadACL();
  const list = state[address] || [];
  
  // Update or insert
  const existingIndex = list.findIndex(r => r.npub === npub);
  if (existingIndex >= 0) {
    list[existingIndex] = { npub, role, timestamp: Date.now() };
  } else {
    list.push({ npub, role, timestamp: Date.now() });
  }
  
  state[address] = list;
  saveACL(state);
}

export function removeACLRecord(address: string, npub: string) {
  const state = loadACL();
  if (!state[address]) return;
  state[address] = state[address].filter(r => r.npub !== npub);
  saveACL(state);
}

export function migrateACL(oldAddress: string, newAddress: string) {
  const state = loadACL();
  if (state[oldAddress]) {
    state[newAddress] = [...state[oldAddress]];
    delete state[oldAddress];
    saveACL(state);
  }
}
