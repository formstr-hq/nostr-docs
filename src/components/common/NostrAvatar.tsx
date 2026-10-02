import React, { useState, memo, useEffect } from "react";
import Avatar, { type AvatarProps } from "@mui/material/Avatar";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import { alpha, type SxProps, type Theme } from "@mui/material";

export interface NostrAvatarProps extends Omit<AvatarProps, "src" | "alt"> {
  user?: {
    picture?: string;
    avatar?: string;
    name?: string;
    pubkey?: string;
  } | null;
  size?: number;
  fallbackText?: string;
  sx?: SxProps<Theme>;
}

export const NostrAvatar: React.FC<NostrAvatarProps> = memo(({
  user,
  size = 32,
  fallbackText,
  sx,
  ...rest
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const pictureUrl = (user?.picture || user?.avatar || "").trim();

  // Reset failure state when URL changes
  useEffect(() => {
    setImgFailed(false);
  }, [pictureUrl]);

  const initial =
    fallbackText ||
    user?.name?.[0]?.toUpperCase() ||
    (user?.pubkey ? user.pubkey.slice(0, 2).toUpperCase() : undefined);

  if (pictureUrl && !imgFailed) {
    return (
      <Avatar
        src={pictureUrl}
        alt={user?.name || "User Avatar"}
        imgProps={{
          referrerPolicy: "no-referrer",
          crossOrigin: "anonymous",
          onError: () => setImgFailed(true),
        }}
        sx={{
          width: size,
          height: size,
          ...sx,
        }}
        {...rest}
      >
        {initial}
      </Avatar>
    );
  }

  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.42),
        fontWeight: 700,
        bgcolor: (t) => alpha(t.palette.secondary.main, 0.85),
        color: "secondary.contrastText",
        ...sx,
      }}
      {...rest}
    >
      {initial || <PersonOutlineOutlinedIcon sx={{ fontSize: size * 0.6 }} />}
    </Avatar>
  );
});
