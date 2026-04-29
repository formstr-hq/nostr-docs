import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FormstrSDK } from "@formstr/sdk";
import type { MyFormSummary, FormsSigner } from "@formstr/sdk";
import { signerManager } from "../signer";
import { useRelays } from "./RelayContext";

const sdk = new FormstrSDK();

interface MyFormsContextValue {
  forms: MyFormSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const MyFormsContext = createContext<MyFormsContextValue>({
  forms: [],
  loading: false,
  refresh: async () => {},
});

export function useMyForms() {
  return useContext(MyFormsContext);
}

export function MyFormsProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<MyFormSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const { relays } = useRelays();
  const loadedForPubRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const load = async (force = false) => {
    if (!signerManager.hasSigner()) {
      setForms([]);
      loadedForPubRef.current = null;
      return;
    }

    const signer = await signerManager.getSigner();
    const pub = await signer.getPublicKey();

    if (!force && loadedForPubRef.current === pub) return;
    if (isLoadingRef.current) return;

    // Build a FormsSigner — only proceed if NIP-44 is available
    if (!signer.nip44Encrypt || !signer.nip44Decrypt) return;

    const formsSigner: FormsSigner = {
      getPublicKey: () => signer.getPublicKey(),
      signEvent: (ev) => signer.signEvent(ev),
      nip44Encrypt: (p, t) => signer.nip44Encrypt!(p, t),
      nip44Decrypt: (p, c) => signer.nip44Decrypt!(p, c),
    };

    isLoadingRef.current = true;
    setLoading(true);
    try {
      const result = await sdk.fetchMyForms(formsSigner, relays);
      setForms(result);
      loadedForPubRef.current = pub;
    } catch {
      // Non-fatal — picker will show empty state
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  };

  // Reload whenever the signer changes (login / logout)
  useEffect(() => {
    load();
    const unsub = signerManager.onChange(() => {
      loadedForPubRef.current = null;
      load();
    });
    return () => { unsub(); };
  }, []);

  // Also reload when relays change (user may have changed relay config)
  useEffect(() => {
    loadedForPubRef.current = null;
    load();
  }, [relays.join(",")]);

  return (
    <MyFormsContext.Provider
      value={{ forms, loading, refresh: () => load(true) }}
    >
      {children}
    </MyFormsContext.Provider>
  );
}
