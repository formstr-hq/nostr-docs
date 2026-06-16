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
import UnlockModal from "../components/UnlockModal";
import MigrationModal from "../components/MigrationModal";

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
  /** Active account exists but its signer is locked (ncryptsec). */
  locked: boolean;
  loginModal: () => Promise<void>;
  /** Open the login modal to add another identity (keeps existing ones). */
  addAccount: () => void;
  /** Prompt for the passphrase to unlock the active locked account. */
  unlock: () => void;
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
  const [locked, setLocked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showMigration, setShowMigration] = useState(false);
  const [pendingMigration, setPendingMigration] = useState<{
    pubkey: string;
    source: "guest" | "nsec";
  } | null>(null);
  const relays = useRelays();

  // Refs avoid stale closures inside the once-registered signer listener.
  const loginHandlerRef = useRef<(() => void) | null>(null);
  const cancelHandlerRef = useRef<(() => void) | null>(null);
  const unlockResolveRef = useRef<(() => void) | null>(null);
  const unlockRejectRef = useRef<((e: Error) => void) | null>(null);
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
    const migration = signerManager.getPendingMigration();
    setPendingMigration(migration);
    setShowMigration(Boolean(migration));

    const list = await signerManager.listAccounts();
    const active = signerManager.getActiveAccount();
    setActiveAccount(active);
    setLocked(signerManager.isLocked());
    setAccounts(
      list.map((a) => {
        const p = profileCache.current.get(a.pubkey);
        return { ...a, name: p?.name, avatar: p?.avatar };
      }),
    );

    if (active) {
      if (!signerManager.isLocked()) {
        loginHandlerRef.current?.();
        loginHandlerRef.current = null;
      }
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

  // syncFromSigner is stable, so this registers callbacks + restores once.
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

    signerManager.registerUnlockModal(() => {
      return new Promise<void>((resolve, reject) => {
        setShowUnlockModal(true);
        unlockResolveRef.current = resolve;
        unlockRejectRef.current = reject;
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

  const unlock = () => {
    setShowUnlockModal(true);
  };

  const switchAccount = async (pubkey: string) => {
    await signerManager.switchAccount(pubkey); // notify → syncFromSigner
    if (signerManager.isLocked()) setShowUnlockModal(true);
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

  // ── Unlock modal handlers ──
  const handleUnlockSubmit = async (passphrase: string) => {
    await signerManager.unlockActive(passphrase); // throws on wrong passphrase
    setShowUnlockModal(false);
    unlockResolveRef.current?.();
    unlockResolveRef.current = null;
    unlockRejectRef.current = null;
  };

  const handleUnlockCancel = () => {
    setShowUnlockModal(false);
    unlockRejectRef.current?.(new Error("Unlock cancelled"));
    unlockResolveRef.current = null;
    unlockRejectRef.current = null;
  };

  // ── Migration modal handlers ──
  const handleMigrate = async (passphrase: string) => {
    await signerManager.migrate(passphrase); // notify → syncFromSigner hides it
  };

  const handleMigrationDismiss = () => {
    // Keep the legacy key for a later attempt; just hide for this session.
    setShowMigration(false);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        accounts,
        activeAccount,
        locked,
        loginModal,
        addAccount,
        unlock,
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
      <UnlockModal
        open={showUnlockModal}
        npub={activeAccount?.npub}
        onSubmit={handleUnlockSubmit}
        onCancel={handleUnlockCancel}
      />
      {pendingMigration && (
        <MigrationModal
          open={showMigration}
          source={pendingMigration.source}
          onMigrate={handleMigrate}
          onDismiss={handleMigrationDismiss}
        />
      )}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within UserProvider");
  return context;
};
