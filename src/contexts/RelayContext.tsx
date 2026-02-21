import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useUser } from "../contexts/UserContext";
import { DEFAULT_RELAYS, pool } from "../nostr/relayPool";

interface RelayContextInterface {
  relays: string[];
  isUsingUserRelays: boolean;
}
const defaultRelays = DEFAULT_RELAYS;
export const RelayContext = createContext<RelayContextInterface>({
  relays: defaultRelays,
  isUsingUserRelays: false,
});

export function RelayProvider({ children }: { children: ReactNode }) {
  const [relays, setRelays] = useState<string[]>(defaultRelays);
  const [isUsingUserRelays, setIsUsingUserRelays] = useState<boolean>(false);
  const { user } = useUser();

  useEffect(() => {
    // Reset to default relays when user logs out
    if (!user) {
      setRelays(defaultRelays);
      setIsUsingUserRelays(false);
      return;
    }

    // Fetch user's relay list when logged in
    const fetchUserRelays = async () => {
      try {
        const filters = { kinds: [10002], authors: [user.pubkey!] };
        const results = await pool.querySync(defaultRelays, filters);

        if (results && results.length > 0) {
          results.sort((a, b) => b.created_at - a.created_at);
          const userRelays = results[0].tags
            .filter((tag) => tag[0] === "r")
            .map((tag) => tag[1]);

          if (userRelays.length > 0) {
            setRelays(userRelays);
            setIsUsingUserRelays(true);
            return;
          }
        }

        // Fallback to default relays if no user relays found
        setRelays(defaultRelays);
        setIsUsingUserRelays(false);
      } catch (error) {
        console.error("Error fetching user relays:", error);
        setRelays(defaultRelays);
        setIsUsingUserRelays(false);
      }
    };

    fetchUserRelays();
  }, [user]);

  return (
    <RelayContext.Provider value={{ relays, isUsingUserRelays }}>
      {children}
    </RelayContext.Provider>
  );
}

export function useRelays() {
  const context = useContext(RelayContext);

  if (!context) {
    console.warn("useRelays must be used within a RelayProvider");
    return { relays: defaultRelays, isUsingUserRelays: false };
  }

  return context;
}
