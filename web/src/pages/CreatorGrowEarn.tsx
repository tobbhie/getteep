import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorGrowEarn() {
  return (
    <CreatorDashboardSkeleton
      title="Earn"
      eyebrow="Grow your tips"
      description="A future home for creator earning routes once the backing strategy, risk copy, and account controls are ready."
      primaryCards={[
        { label: "Available to grow", value: "$0.00", detail: "Uses creator payout balance when enabled.", icon: "savings" },
        { label: "Strategy", value: "Gated", detail: "No active strategy until the implementation is safe.", icon: "lock" },
        { label: "Control", value: "Creator owned", detail: "Actions must remain confirmable and reversible where supported.", icon: "verified_user" },
      ]}
      sections={[
        { title: "No logicless yield UI", body: "Do not add earning CTAs until the strategy path exists.", icon: "warning" },
        { title: "Risk language", body: "Any earning route needs clear, user-friendly risk and exit behavior.", icon: "health_and_safety" },
      ]}
    />
  );
}
