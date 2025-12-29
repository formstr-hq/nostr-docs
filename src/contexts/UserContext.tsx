// src/contexts/UserContext.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { signerManager } from "../signer";
import { fetchProfile } from "../nostr/fetchProfile"; // function to fetch kind-0 metadata
import { withTimeout } from "../utils/timeout";
import { useRelays } from "./RelayContext";

export type UserProfile = {
  pubkey?: string;
  name?: string;
  avatar?: string; // url
  about?: string;
};

interface UserContextType {
  user: UserProfile | null;
  loginModal: () => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = "formstr:userProfile";

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const relays = useRelays();
  // Load cached profile
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

  // Listen to signerManager changes
  useEffect(() => {
    signerManager.onChange(async () => {
      console.log("On change truggered");
      if (signerManager["signer"]) {
        const signer = await signerManager.getSigner();
        const pubkey = await signer.getPublicKey();
        console.log("calling fetch and set");
        await fetchAndSetProfile(pubkey);
      } else {
        setUser(null);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    });

    // Restore signer on mount (triggers onChange)
    signerManager.restoreFromStorage();
  }, []);

  // Fetch kind-0 metadata and update state + localStorage
  const fetchAndSetProfile = async (pubkey: string) => {
    console.log("called fetch and set");
    try {
      const profile = (await withTimeout(
        fetchProfile(pubkey, relays.relays),
        8000
      )) as UserProfile;
      console.log("Found profile", profile);
      const userProfile: UserProfile = { pubkey, ...profile };
      console.log("Setting user profile", userProfile);
      setUser(userProfile);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(userProfile));
    } catch (e) {
      console.error("Failed to fetch user profile:", e);
      setUser({ pubkey }); // fallback to minimal profile
      console.log("Setting user profile", pubkey);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ pubkey }));
    }
  };

  const loginModal = async () => {
    try {
      const signer = await signerManager.getSigner(); // calls login modal if no signer
      const pubkey = await signer.getPublicKey();
      await fetchAndSetProfile(pubkey);
    } catch (e) {
      console.error("Login canceled or failed:", e);
    }
  };

  const logout = () => {
    signerManager.logout();
    setUser(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  };

  const refreshProfile = async () => {
    if (!user?.pubkey) return;
    await fetchAndSetProfile(user.pubkey);
  };

  return (
    <UserContext.Provider value={{ user, loginModal, logout, refreshProfile }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within UserProvider");
  return context;
};
