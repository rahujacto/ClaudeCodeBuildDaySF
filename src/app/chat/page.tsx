import { redirect } from "next/navigation";

// Chat now lives in a persistent dock (see AppHeader → ChatDock), available on
// every page. Keep this route as a redirect for old links/bookmarks.
export default function ChatPage() {
  redirect("/dashboard");
}
