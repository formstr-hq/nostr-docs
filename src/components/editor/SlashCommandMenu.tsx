import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Box, Paper, Typography, useTheme } from "@mui/material";
import type { SlashCommandItem } from "./extensions/SlashCommand";

export interface SlashCommandMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, Props>(
  ({ items, command }, ref) => {
    const theme = useTheme();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedRef = useRef<HTMLDivElement | null>(null);

    // Reset selection when items change (user typed a new char)
    useEffect(() => setSelectedIndex(0), [items]);

    // Keep selected item scrolled into view
    useEffect(() => {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          if (items[selectedIndex]) command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    return (
      <Paper
        elevation={8}
        sx={{
          width: 280,
          maxHeight: 320,
          overflowY: "auto",
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: "background.paper",
          py: 0.5,
          // Notion-like shadow
          boxShadow:
            "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)",
        }}
      >
        {/* Group label */}
        <Typography
          variant="caption"
          sx={{
            display: "block",
            px: 2,
            pt: 0.5,
            pb: 0.25,
            color: "text.disabled",
            fontWeight: 600,
            fontSize: "0.65rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Basic blocks
        </Typography>

        {items.map((item, index) => (
          <Box
            key={item.id}
            ref={index === selectedIndex ? selectedRef : null}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => command(item)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 0.75,
              cursor: "pointer",
              borderRadius: 1,
              mx: 0.5,
              bgcolor:
                index === selectedIndex ? "action.selected" : "transparent",
              "&:hover": { bgcolor: "action.hover" },
              transition: "background-color 0.1s",
            }}
          >
            {/* Icon swatch — Notion-style light box */}
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1,
                border: `1px solid ${theme.palette.divider}`,
                bgcolor: "background.default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              {item.icon}
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 500,
                  lineHeight: 1.3,
                  color:
                    index === selectedIndex
                      ? "text.primary"
                      : "text.primary",
                }}
              >
                {item.label}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  lineHeight: 1.2,
                  display: "block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.description}
              </Typography>
            </Box>
          </Box>
        ))}
      </Paper>
    );
  },
);

SlashCommandMenu.displayName = "SlashCommandMenu";
