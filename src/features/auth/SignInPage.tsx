import { ArrowRight, LockKeyhole } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";
import "../../styles/workflow.css";

export function SignInPage() {
  const error = new URLSearchParams(window.location.search).get("auth_error");
  const errorMessages: Record<string, string> = {
    access_denied: "Webex sign-in was cancelled.",
    domain_not_allowed: "This Webex account is not in an approved TD SYNNEX domain.",
    invalid_callback: "Webex returned an incomplete sign-in response. Please try again.",
    invalid_state: "The sign-in request expired or could not be verified. Please try again.",
    oauth_failed: "Webex sign-in could not be completed. Please try again.",
    service_not_configured: "TDS cannot load team permissions because its data service is not configured for this environment.",
    unverified_email: "Your Webex account must have a verified email address.",
  };

  return (
    <main className="sign-in-page">
      <section className="sign-in-panel">
        <BrandMark />
        <div className="sign-in-copy">
          <span className="eyebrow">Private TD SYNNEX knowledge</span>
          <h1>Find trusted answers from the Webex spaces your team shares.</h1>
          <p>Search approved guidance, revisit resolved questions, and find the context your team needs.</p>
        </div>
        <a className="primary-button" href="/api/auth/webex/start">
          Continue with Webex <ArrowRight size={18} />
        </a>
        {error && <p className="auth-error" role="alert">{errorMessages[error] || "Sign-in could not be completed."}</p>}
        <p className="security-note"><LockKeyhole size={15} /> Access is restricted to approved TD SYNNEX accounts.</p>
      </section>
    </main>
  );
}
