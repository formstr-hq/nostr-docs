// src/contexts/UserContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { signerManager } from "../signer";
import type { AccountSummary } from "../signer";
import { fetchProfile } from "../nostr/fetchProfile"; // function to fetch kind-0 metadata
import { withTimeout } from "../utils/timeout";
import { useRelays } from "./RelayContext";
import LoginModal from "../components/LoginModal";

export type UserProfile = {
  pubkey?: string;
  name?: string;
  avatar?: string; // url
  about?: string;
};

/** An account in the switcher, enriched with its profile for display. */
export type Account = AccountSummary & { name?: string; avatar?: string };

interface UserContextType {
  user: UserProfile | null;
  accounts: Account[];
  activeAccount: AccountSummary | null;
  loginModal: () => Promise<void>;
  /** Open the login modal to add another identity (keeps existing ones). */
  addAccount: () => void;
  switchAccount: (pubkey: string) => Promise<void>;
  /** Remove an account (defaults to the active one). */
  logout: (pubkey?: string) => void;
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = "formstr:userProfile";

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountSummary | null>(
    null,
  );
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const relays = useRelays();

  // Refs avoid stale closures inside the once-registered signer listener.
  const loginHandlerRef = useRef<(() => void) | null>(null);
  const cancelHandlerRef = useRef<(() => void) | null>(null);
  const profileCache = useRef<Map<string, UserProfile>>(new Map());
  const relaysRef = useRef(relays);
  useEffect(() => {
    relaysRef.current = relays;
  }, [relays]);

  // Load cached active profile (fast first paint before relays answer)
  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse cached user profile:", e);
      }
    }
  }, []);

  // Fetch kind-0 metadata for one account, update cache + any UI showing it.
  const fetchProfileFor = useCallback(async (pubkey: string) => {
    try {
      const profile = (await withTimeout(
        fetchProfile(pubkey, relaysRef.current.relays),
        3000,
      )) as UserProfile;
      profileCache.current.set(pubkey, profile);
      setAccounts((prev) =>
        prev.map((a) =>
          a.pubkey === pubkey
            ? { ...a, name: profile.name, avatar: profile.avatar }
            : a,
        ),
      );
      setUser((prev) =>
        prev?.pubkey === pubkey ? { pubkey, ...profile } : prev,
      );
      if (signerManager.getActiveAccount()?.pubkey === pubkey) {
        localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify({ pubkey, ...profile }),
        );
      }
    } catch {
      // Keep the pubkey-only entry; relays may be slow/unreachable.
    }
  }, []);

  // Re-read the full account list + active identity from the signer.
  const syncFromSigner = useCallback(async () => {
    const list = await signerManager.listAccounts();
    const active = signerManager.getActiveAccount();
    setActiveAccount(active);
    setAccounts(
      list.map((a) => {
        const p = profileCache.current.get(a.pubkey);
        return { ...a, name: p?.name, avatar: p?.avatar };
      }),
    );

    if (active) {
      // Resolve any pending login-modal promise now that a signer exists.
      loginHandlerRef.current?.();
      loginHandlerRef.current = null;
      const cached = profileCache.current.get(active.pubkey);
      const profile = { pubkey: active.pubkey, ...cached };
      setUser(profile);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
    } else {
      setUser(null);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    list.forEach((a) => {
      if (!profileCache.current.has(a.pubkey)) fetchProfileFor(a.pubkey);
    });
  }, [fetchProfileFor]);

  // syncFromSigner is stable (its only dep, fetchProfileFor, has no deps), so
  // this effect registers the modal + listener and restores exactly once.
  useEffect(() => {
    signerManager.registerLoginModal(() => {
      return new Promise<void>((resolve, reject) => {
        setShowLoginModal(true);
        loginHandlerRef.current = () => {
          setShowLoginModal(false);
          resolve();
        };
        cancelHandlerRef.current = () => {
          setShowLoginModal(false);
          reject(new Error("Login cancelled by user"));
        };
      });
    });

    const unsubscribe = signerManager.onChange(() => {
      syncFromSigner();
    });

    // Restore signer on mount (triggers onChange via notify)
    signerManager.restoreFromStorage();

    return () => {
      unsubscribe();
    };
  }, [syncFromSigner]);

  const loginModal = async () => {
    try {
      await signerManager.getSigner(); // opens modal if no active signer
      await syncFromSigner();
    } catch (e) {
      console.error("Login canceled or failed:", e);
    }
  };

  const addAccount = () => {
    setShowLoginModal(true);
  };

  const switchAccount = async (pubkey: string) => {
    await signerManager.switchAccount(pubkey); // notify → syncFromSigner
  };

  const logout = (pubkey?: string) => {
    signerManager.logout(pubkey); // notify → syncFromSigner
  };

  const refreshProfile = async () => {
    const active = signerManager.getActiveAccount();
    if (!active) return;
    profileCache.current.delete(active.pubkey);
    await fetchProfileFor(active.pubkey);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        accounts,
        activeAccount,
        loginModal,
        addAccount,
        switchAccount,
        logout,
        refreshProfile,
      }}
    >
      {children}
      <LoginModal
        open={showLoginModal}
        onClose={() => {
          cancelHandlerRef.current?.();
          cancelHandlerRef.current = null;
          setShowLoginModal(false);
        }}
      />
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within UserProvider");
  return context;
};
