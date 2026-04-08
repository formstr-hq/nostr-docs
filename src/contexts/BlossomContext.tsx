import { createContext, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY = "formstr:blossom-servers";
const DEFAULT_SERVERS = ["https://blossom.primal.net"];

interface BlossomContextType {
  servers: string[];
  addServer: (url: string) => void;
  removeServer: (url: string) => void;
}

const BlossomContext = createContext<BlossomContextType>({
  servers: DEFAULT_SERVERS,
  addServer: () => {},
  removeServer: () => {},
});

export function BlossomProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
      }
    } catch {
      // ignore
    }
    return DEFAULT_SERVERS;
  });

  const save = (list: string[]) => {
    setServers(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const addServer = (url: string) => {
    const normalized = url.trim().replace(/\/$/, "");
    if (!normalized || servers.includes(normalized)) return;
    save([...servers, normalized]);
  };

  const removeServer = (url: string) => {
    save(servers.filter((s) => s !== url));
  };

  return (
    <BlossomContext.Provider value={{ servers, addServer, removeServer }}>
      {children}
    </BlossomContext.Provider>
  );
}

export function useBlossomServers() {
  return useContext(BlossomContext);
}
