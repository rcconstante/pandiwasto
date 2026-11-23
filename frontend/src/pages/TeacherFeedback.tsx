import { loadSurveyStatus } from "@/lib/arcadeApi";
import { useRemote } from "./adminActions";
import { LoadState, PageHeader } from "./StaffKit";
import { StudySurvey } from "./StudySurvey";
import "./dashboard-research.css";

/** Teacher usability survey for the study report; one response per teacher. */
export function TeacherFeedback() {
  const { state, reload } = useRemote(loadSurveyStatus, "survey-status");
  return (
    <>
      <PageHeader title="Feedback" description="Five quick statements about using PandiWasto with your classes. Your answers go into the study report." />
      {state.status !== "ready"
        ? <LoadState status={state.status} what="your feedback status" onRetry={reload} />
        : state.data.submitted
          ? <p className="st-empty">Thank you. Your feedback is saved.</p>
          : <StudySurvey respondent="teacher" onSubmitted={reload} />}
    </>
  );
}
