import "@/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getWelcomeAvailability } from "@/services/api/welcome";
import WelcomePage from "@/pages/welcome";
import { translate } from "@/i18n";
import { SystemUpdateNotice } from "@/components/layout/system-update-notice";

async function renderWelcome() {
    try {
        const { welcomeEnabled } = await getWelcomeAvailability();
        if (welcomeEnabled !== true) {
            window.location.replace("/");
            return;
        }
        createRoot(document.getElementById("root")!).render(
            <StrictMode>
                <SystemUpdateNotice />
                <WelcomePage />
            </StrictMode>,
        );
    } catch (error) {
        console.error("Welcome page initialization failed", error);
        createRoot(document.getElementById("root")!).render(
            <>
                <SystemUpdateNotice />
                <main role="alert">
                    <p>{translate("account.welcome.openFailed")}</p>
                    <button onClick={() => window.location.reload()}>{translate("common.retry")}</button>
                    <a href="/">{translate("auth.backHome")}</a>
                </main>
            </>,
        );
    }
}

void renderWelcome();
