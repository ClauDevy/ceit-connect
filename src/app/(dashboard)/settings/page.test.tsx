import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  single: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: mocks.single }),
      }),
    }),
  })),
}))
vi.mock("@/components/shared/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock("@/components/settings/settings-section", () => ({
  SettingsSection: ({ title, motionIndex, className, children }: { title: string; motionIndex: number; className?: string; children: React.ReactNode }) => (
    <section data-title={title} data-motion-index={motionIndex} className={className}>{children}</section>
  ),
}))
vi.mock("@/components/settings/set-password-form", () => ({ SetPasswordForm: () => <div /> }))
vi.mock("@/components/settings/avatar-uploader", () => ({ AvatarUploader: () => <div /> }))
vi.mock("@/components/settings/full-name-form", () => ({ FullNameForm: () => <div /> }))
vi.mock("@/components/settings/install-app-help", () => ({ InstallAppHelp: () => <div /> }))
vi.mock("@/components/settings/push-notifications-control", () => ({ PushNotificationsControl: () => <div /> }))
vi.mock("@/components/layout/push-aware-sign-out-form", () => ({
  PushAwareSignOutForm: ({ userId, children }: { userId: string; children: React.ReactNode }) => (
    <form data-push-aware-user={userId}>{children}</form>
  ),
}))

import SettingsPage from "./page"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue({ id: "settings-user" })
  mocks.single.mockResolvedValue({
    data: { full_name: "Settings User", password_set: true, avatar_url: null },
    error: null,
  })
})

describe("Settings sign-out and Terms links", () => {
  it("keeps Help and Terms together and renders the final push-aware Sign out section", async () => {
    const html = renderToStaticMarkup(await SettingsPage())

    expect(html).toContain('href="/help"')
    expect(html).toContain('href="/terms"')
    expect(html).toContain("sm:grid-cols-2")
    expect(html).toContain('data-title="Sign out"')
    expect(html).toContain('data-motion-index="6"')
    expect(html).toContain("lg:col-span-2")
    expect(html).toContain('data-push-aware-user="settings-user"')
    expect(html.indexOf('data-title="Sign out"')).toBeGreaterThan(html.indexOf('data-title="Install the app"'))
  })
})
