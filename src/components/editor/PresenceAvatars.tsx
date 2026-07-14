import { AvatarGroup, Avatar, Tooltip } from "@mui/material";
import type { TrustedCollaborator } from "../../collab/useTrustedCollaborators";

interface PresenceAvatarsProps {
  collaborators: Map<string, TrustedCollaborator>;
}

/**
 * Shows the other collaborators currently editing this document. Takes the
 * already-resolved trusted collaborator map (computed once in
 * DocEditorController via useTrustedCollaborators and shared with the
 * CollaborationCaret extension's render callbacks) rather than resolving it
 * again itself.
 */
export function PresenceAvatars({ collaborators }: PresenceAvatarsProps) {
  if (collaborators.size === 0) return null;

  return (
    <AvatarGroup max={5} sx={{ mr: 1 }}>
      {[...collaborators.values()].map((c) => (
        <Tooltip key={c.sessionPubkey} title={c.name}>
          <Avatar
            src={c.picture}
            role="img"
            aria-label={c.name}
            sx={{
              width: 28,
              height: 28,
              fontSize: 13,
              bgcolor: c.color,
              border: `2px solid ${c.color}`,
            }}
          >
            {c.name.slice(0, 1).toUpperCase()}
          </Avatar>
        </Tooltip>
      ))}
    </AvatarGroup>
  );
}
