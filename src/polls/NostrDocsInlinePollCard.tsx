import { InlinePollCard } from "@formstr/polls";
import { useRelays } from "../contexts/RelayContext";
import { nostrDocsPollAdapter } from "./nostrDocsPollAdapter";

export function NostrDocsInlinePollCard({ nevent }: { nevent: string }) {
  const { relays } = useRelays();

  return (
    <InlinePollCard
      nevent={nevent}
      userRelays={relays}
      adapter={nostrDocsPollAdapter}
    />
  );
}
