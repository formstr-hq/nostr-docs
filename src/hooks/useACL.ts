import { useState, useEffect, useCallback } from "react";
import { loadACL, addACLRecord, removeACLRecord } from "../lib/ACLStore";
import type { ACLRecord, ACLRole } from "../lib/ACLStore";

export function useACL(address?: string) {
  const [acl, setAcl] = useState<ACLRecord[]>([]);

  const refresh = useCallback(() => {
    if (!address) {
      setAcl([]);
      return;
    }
    const state = loadACL();
    setAcl(state[address] || []);
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grantAccess = (npub: string, role: ACLRole) => {
    if (!address) return;
    addACLRecord(address, npub, role);
    refresh();
  };

  const revokeAccess = (npub: string) => {
    if (!address) return;
    removeACLRecord(address, npub);
    refresh();
  };

  return { acl, grantAccess, revokeAccess, refreshACL: refresh };
}
