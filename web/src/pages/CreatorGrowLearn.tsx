import CreatorDashboardSkeleton from "./CreatorDashboardSkeleton";

export default function CreatorGrowLearn() {
  return (
    <CreatorDashboardSkeleton
      title="Learn"
      eyebrow="Grow your tips"
      description="Explain how creators can increase support, understand claim and payout flows, and use Teep without needing technical language."
      primaryCards={[
        { label: "Claiming", value: "Guide", detail: "How tips become available after X verification.", icon: "how_to_reg" },
        { label: "Sharing", value: "Guide", detail: "How to invite supporters to tip posts or directly support.", icon: "ios_share" },
        { label: "Payouts", value: "Guide", detail: "How withdrawals and referral fees work.", icon: "payments" },
      ]}
      sections={[
        { title: "Creator-first education", body: "Keep content practical and support-focused, not protocol-heavy.", icon: "school" },
        { title: "Contextual links", body: "Later, link lessons to the exact dashboard state a creator is in.", icon: "link" },
      ]}
    />
  );
}
