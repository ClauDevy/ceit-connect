import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, FileText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InlineAlert } from "@/components/ui/inline-alert"
import { buttonVariants } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Terms of Service | CEIT Connect",
}

async function hasSignedInUser() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) return false
    return Boolean(data.user)
  } catch {
    return false
  }
}

export default async function TermsPage() {
  const signedIn = await hasSignedInUser()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-5">
        <InlineAlert variant="warning" className="space-y-1">
          <p className="font-semibold">Draft version</p>
          <p>
            This draft is for the owner and adviser to review. It is not legal advice.
          </p>
        </InlineAlert>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <FileText className="size-5" />
              </span>
              <CardTitle className="text-2xl sm:text-3xl">Terms of Service</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 text-sm leading-6 sm:text-base sm:leading-7">
            <section aria-labelledby="access-heading" className="space-y-2">
              <h2 id="access-heading" className="font-display text-lg font-semibold">Access and sign-in</h2>
              <p>
                CEIT Connect is an invite-only workspace for the CEIT Student Council. Invited accounts can sign in with an email link, Google, or a password.
              </p>
            </section>

            <section aria-labelledby="use-heading" className="space-y-2">
              <h2 id="use-heading" className="font-display text-lg font-semibold">Using the workspace</h2>
              <p>
                The workspace supports council events, tasks, comments, and task access controls. Some tasks can be marked confidential, and what a person can read depends on their current role and task access in the app.
              </p>
              <p>
                Google Drive items added to tasks are saved as links. CEIT Connect does not upload the linked Drive files into the task record.
              </p>
            </section>

            <section aria-labelledby="accounts-heading" className="space-y-2">
              <h2 id="accounts-heading" className="font-display text-lg font-semibold">Account changes</h2>
              <p>
                Council accounts are deactivated instead of deleted. A former member account can be anonymized while keeping its existing identifier connected to council records.
              </p>
            </section>

            <section aria-labelledby="privacy-heading" className="space-y-2">
              <h2 id="privacy-heading" className="font-display text-xl font-semibold">Privacy</h2>
              <p>
                CEIT Connect uses invited account details and the events, tasks, comments, and links entered into the workspace to provide its council features.
              </p>
              <p>
                Push notifications are optional and are enabled per device. They can be managed from Settings on that device.
              </p>
            </section>

            <section aria-labelledby="contact-heading" className="space-y-2">
              <h2 id="contact-heading" className="font-display text-lg font-semibold">Questions</h2>
              <p>Contact: [contact email to be confirmed]</p>
            </section>
          </CardContent>
        </Card>

        <Link
          href={signedIn ? "/home" : "/login"}
          className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}
        >
          <ArrowLeft aria-hidden />
          {signedIn ? "Back to home" : "Back to sign in"}
        </Link>
      </div>
    </main>
  )
}
