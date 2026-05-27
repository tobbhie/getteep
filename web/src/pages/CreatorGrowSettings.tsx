import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorGrowSettings() {
  return (
    <CreatorDashboardSkeleton
      title="Grow Settings"
      eyebrow="Grow your tips"
      description="Manage future grow-tip preferences only when those preferences are enforceable across the creator account."
      primaryCards={[
        { label: "Preferences", value: "Not active", detail: "No strategy preferences are live yet.", icon: "tune" },
        { label: "Confirmations", value: "Required", detail: "Sensitive money movement must always confirm.", icon: "task_alt" },
        { label: "Visibility", value: "Private", detail: "Growth activity should not leak publicly by default.", icon: "visibility_off" },
      ]}
      sections={[
        { title: "System rules stay system rules", body: "Do not turn required confirmations or post/direct distinctions into preferences.", icon: "rule" },
        { title: "Persisted settings only", body: "Every toggle or field must be backed by database or strategy logic.", icon: "database" },
      ]}
    />
  );
}
