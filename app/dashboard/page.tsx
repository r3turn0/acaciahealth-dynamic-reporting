import { redirect } from "next/navigation";

/**
 * Preserve the authenticated dashboard URL while routing into the canonical
 * workspace shell. The root workspace owns navigation state for every module;
 * rendering DashboardHome directly here previously produced inert quick links.
 */
export default function DashboardPage() {
  redirect("/");
}
