import * as fs from 'fs'
import * as puppeteer from 'puppeteer'

export const launchBrowser = async (
  userDataDir: string
): Promise<puppeteer.Browser> => {
  // Clean up any stale Chromium profile locks from previously killed sessions
  if (fs.existsSync(userDataDir)) {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    for (const file of lockFiles) {
      const lockPath = `${userDataDir}/${file}`
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath)
        } catch (_) {}
      }
    }
  }

  const possiblePaths = [
    '/usr/bin/brave',
    '/usr/bin/brave-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]

  const executablePath = possiblePaths.find(p => fs.existsSync(p))

  const isWayland = Boolean(
    process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland'
  )

  const args = [
    '--window-size=1920,1080',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled'
  ]

  if (isWayland) {
    args.push('--enable-features=UseOzonePlatform', '--ozone-platform=wayland')
  }

  const launchOptions: any = {
    headless: false,
    userDataDir,
    // Disables the "Brave is being controlled by automated test software" flag
    ignoreDefaultArgs: ['--enable-automation'],
    args,
    defaultViewport: null
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath
  }

  return puppeteer.launch(launchOptions)
}

export const setupPage = async (page: puppeteer.Page) => {
  // Masks navigator.webdriver to bypass Akamai Bot Manager / Cloudflare
  // Note: Do NOT override user-agent or extra headers here; letting the browser
  // use its native headers prevents Akamai TLS/Client-Hints fingerprint mismatch blocks.
  await page.evaluateOnNewDocument(() => {
    delete (Object.getPrototypeOf(navigator) as any).webdriver
  })
}
