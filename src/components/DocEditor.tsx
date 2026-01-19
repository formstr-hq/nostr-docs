// import { useEffect, useState } from "react";
// import {
//   Box,
//   Paper,
//   Button,
//   Typography,
//   useTheme,
//   IconButton,
//   Snackbar,
//   Alert,
// } from "@mui/material";
// import ReactMarkdown from "react-markdown";
// import { publishEvent } from "../nostr/publish";
// import { useDocumentContext } from "../contexts/DocumentContext";
// import { signerManager } from "../signer";
// import { useRelays } from "../contexts/RelayContext";
// import EditIcon from "@mui/icons-material/Edit";
// import VisibilityIcon from "@mui/icons-material/Visibility";
// import { useMediaQuery } from "@mui/material";
// import ShareModal from "./ShareModal";
// import MoreVertIcon from "@mui/icons-material/MoreVert";
// import { Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material";
// import DeleteIcon from "@mui/icons-material/Delete";
// import ShareIcon from "@mui/icons-material/Share";
// import { deleteEvent } from "../nostr/deleteRequest";
// import ConfirmModal from "./common/ConfirmModal";
// import {
//   finalizeEvent,
//   generateSecretKey,
//   getPublicKey,
//   nip19,
//   nip44,
//   type Event,
// } from "nostr-tools";
// import { encodeNKeys } from "../utils/nkeys";
// import { bytesToHex, hexToBytes } from "nostr-tools/utils";
// import { getConversationKey } from "nostr-tools/nip44";
// import { useSharedPages } from "../contexts/SharedDocsContext";
// import { fetchEventsByKind, KIND_FILE } from "../nostr/fetchFile";
// import { useRef } from "react";
// import { useUser } from "../contexts/UserContext";

// export default function DocEditor({
//   viewKey,
//   editKey,
// }: {
//   viewKey?: string;
//   editKey?: string;
// }) {
//   const {
//     documents,
//     selectedDocumentId,
//     removeDocument,
//     addDocument,
//     setSelectedDocumentId,
//   } = useDocumentContext();
//   const doc = documents.get(selectedDocumentId || "");
//   const initial = doc?.decryptedContent || "";
//   const isNewDoc = !selectedDocumentId;
//   const [md, setMd] = useState(initial);
//   const [mode, setMode] = useState<"edit" | "preview">(
//     isNewDoc ? "edit" : "preview",
//   );
//   const [shareOpen, setShareOpen] = useState(false);
//   const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
//   const [autosaveEnabled, setAutosaveEnabled] = useState(true);
//   const [toast, setToast] = useState<{
//     open: boolean;
//     message: string;
//     severity: "success" | "error";
//   }>({
//     open: false,
//     message: "",
//     severity: "success",
//   });
//   const [saving, setSaving] = useState(false);
//   const { addSharedDoc, refresh } = useSharedPages();

//   const theme = useTheme(); // <-- MUI theme hook
//   const { relays } = useRelays();
//   const isMobile = useMediaQuery("(max-width:900px)");
//   const mdRef = useRef(md);
//   const lastSavedMdRef = useRef(md);
//   const { user, loginModal } = useUser();

//   useEffect(() => {
//     mdRef.current = md;
//   }, [md]);

//   useEffect(() => {
//     if (!selectedDocumentId) {
//       setMode("edit");
//       setMd("");
//     } else {
//       setMd(documents.get(selectedDocumentId)?.decryptedContent!);
//       if (!mode) setMode("preview");
//     }
//   }, [selectedDocumentId]);

//   useEffect(() => {
//     if (!selectedDocumentId) {
//       setMode("edit");
//       if (!md) setMd("");
//     } else {
//       setMd(documents.get(selectedDocumentId)?.decryptedContent!);
//       if (!mode) setMode("preview");
//     }
//   }, [documents]);

//   useEffect(() => {
//     if (!autosaveEnabled) return;

//     const interval = setInterval(() => {
//       if (mode === "edit" && md.trim()) {
//         saveSnapshot(mdRef.current);
//       }
//     }, 20000); // autosave every 20 seconds

//     return () => clearInterval(interval); // cleanup on unmount or toggle
//   }, [mode, autosaveEnabled]);

//   useEffect(() => {
//     if (!selectedDocumentId) return;
//     (async () => {
//       let pubkey;
//       if (editKey) pubkey = getPublicKey(hexToBytes(editKey));
//       else pubkey = await (await signerManager.getSigner())!.getPublicKey();

//       fetchEventsByKind(relays, KIND_FILE, pubkey, (event: Event) => {
//         if (viewKey) {
//           addDocument(event, { viewKey });
//         } else {
//           addDocument(event);
//         }
//       });
//     })();
//   }, [selectedDocumentId, relays, viewKey]);

//   const handleDelete = async (skipPrompt = false) => {
//     if (skipPrompt) {
//       await deleteEvent({
//         eventKind: 33457,
//         eventId: selectedDocumentId!,
//         relays,
//         reason: "User requested deletion",
//       });
//       removeDocument(selectedDocumentId!);
//       return;
//     }

//     setConfirmOpen(true);
//   };

//   const saveSnapshot = async (content?: string) => {
//     if (saving) return; // prevent overlapping saves
//     setSaving(true);
//     const mdToSave = content ?? md;
//     try {
//       if (mdToSave === lastSavedMdRef.current) return;
//       const signer = await signerManager.getSigner();

//       if (!signer && !editKey) {
//         console.log("No signer found");
//         setSaving(false);
//         setToast({
//           open: true,
//           message: "Please Login to save",
//           severity: "error",
//         });
//         return;
//       }
//       let dTag = selectedDocumentId;
//       if (!dTag) {
//         dTag = makeTag(6);
//       }
//       const encryptedContent = await encryptContent(mdToSave, viewKey);
//       if (!encryptedContent) return;

//       const event = {
//         kind: 33457,
//         tags: [["d", dTag]],
//         content: encryptedContent,
//         created_at: Math.floor(Date.now() / 1000),
//         pubkey: await signer.getPublicKey!(),
//       };
//       let signed: Event | null = null;
//       if (editKey) signed = finalizeEvent(event, hexToBytes(editKey));
//       else signed = await signer.signEvent(event);
//       await publishEvent(signed!, relays);
//       setSelectedDocumentId(dTag);
//       lastSavedMdRef.current = mdToSave;
//       setToast({ open: true, message: "Saved", severity: "success" });
//     } catch (err) {
//       console.error("Failed to save snapshot:", err);
//       setSaving(false);
//       setToast({ open: true, message: "Failed to save!", severity: "error" });
//     } finally {
//       setSaving(false);
//     }
//   };

//   return (
//     <Box
//       sx={{
//         height: "100%",
//         display: "flex",
//         flexDirection: "column",
//         gap: 2,
//       }}
//     >
//       {/* Toolbar */}

//       {/* Editor Surface */}
//       <Paper
//         elevation={1}
//         sx={{
//           flex: 1, // fill remaining vertical space
//           display: "flex",
//           flexDirection: "column", // textarea grows correctly
//           minHeight: 0, // crucial for Chrome flexbox
//           p: 3,
//           borderRadius: 3,
//           bgcolor: "background.paper",
//           border: "1px solid rgba(0,0,0,0.08)",
//           overflowY: "auto",
//         }}
//       >
//         {mode === "edit" && (
//           <Box
//             component="textarea"
//             value={md}
//             placeholder="Start typing your page here (Markdown supported)"
//             onChange={(e) => setMd(e.target.value)}
//             style={{
//               flex: 1, // use flex instead of height: 100%
//               width: "100%",
//               border: "none",
//               outline: "none",
//               resize: "none",
//               background: "transparent",
//               color: theme.palette.text.primary,
//               fontSize: "17px",
//               lineHeight: 1.7,
//               fontFamily:
//                 '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
//             }}
//           />
//         )}

//         {mode === "preview" && (
//           <Box
//             title="Double-click to edit"
//             onDoubleClick={() => setMode("edit")}
//             sx={{
//               cursor: "text",
//               "& h1,h2,h3,h4": {
//                 color: theme.palette.text.primary,
//                 fontWeight: 800,
//               },
//               "& p": { color: theme.palette.text.secondary },
//             }}
//           >
//             {md?.trim() ? (
//               <ReactMarkdown>{md}</ReactMarkdown>
//             ) : (
//               <Typography color="text.secondary">
//                 Nothing to preview yet,{" "}
//                 {isMobile
//                   ? "double tap this text to edit"
//                   : "double click this text to edit"}
//               </Typography>
//             )}
//           </Box>
//         )}
//       </Paper>
//       <Snackbar
//         open={toast.open}
//         autoHideDuration={3000}
//         onClose={() => setToast({ ...toast, open: false })}
//       >
//         <Alert severity={toast.severity} sx={{ width: "100%" }}>
//           {toast.message}
//         </Alert>
//       </Snackbar>
//     </Box>
//   );
// }
