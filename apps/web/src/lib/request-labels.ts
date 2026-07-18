/** Client-facing labels for request fields (shared across pages). */

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Received — Not Yet Committed",
  IN_REVIEW: "In Review",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  FEATURE: "Feature request",
  BUG: "Bug report",
  CHANGE: "Change request",
  QUESTION: "Question",
  SUPPORT: "Support request",
  OTHER: "Other",
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};
