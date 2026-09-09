"use client";

import CoachSettings from "./coach-settings";
import DayView from "./day-view";
import LeaveReview from "./leave-review";
import MembersList from "./members-list";
import ScheduleForm from "./schedule-form";

/** Rich Menu 各按鈕帶的 ?p= 參數對應到這裡的畫面（SPEC.md §7）。 */
export default function CoachApp({
  idToken,
  page,
}: {
  idToken: string;
  page: string | null;
}) {
  switch (page) {
    case "members":
      return <MembersList idToken={idToken} />;

    case "today":
      return <DayView idToken={idToken} />;

    case "schedule":
      return <ScheduleForm idToken={idToken} />;

    case "leaves":
      return <LeaveReview idToken={idToken} />;

    case "settings":
      return <CoachSettings idToken={idToken} />;

    default:
      return <DayView idToken={idToken} />;
  }
}
