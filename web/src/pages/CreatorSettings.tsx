import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorSettings() {
  return (
    <CreatorDashboardSkeleton
      title="Creator Settings"
      eyebrow="Creator account"
      description="Manage creator identity, payout readiness, receipt preferences, notifications, and privacy controls."
      primaryCards={[
        { label: "Identity", value: "Draft", detail: "Creator username and X verification live here.", icon: "badge" },
        { label: "Payouts", value: "Pending", detail: "Payout account and withdrawal preferences will be wired here.", icon: "account_balance" },
        { label: "Privacy", value: "Default", detail: "Public receipt and activity visibility controls.", icon: "shield" },
      ]}
      sections={[
        { title: "Editable identity", body: "Use the same read/edit/checkmark field flow from tipper settings.", icon: "edit" },
        { title: "Implementable controls only", body: "Settings must persist to the database unless they trigger a sensitive money or account action.", icon: "fact_check" },
      ]}
    />
  );
}
