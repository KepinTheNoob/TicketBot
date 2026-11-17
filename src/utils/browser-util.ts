import * as fs from 'fs'
import * as path from 'path'
import { BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright-extra'
import stealth = require('puppeteer-extra-plugin-stealth')

// Apply the stealth plugin to the Playwright Chromium instance
chromium.use(stealth())

export interface BrowserLaunchOptions {
  executablePath?: string
  proxyServer?: string
  headless?: boolean
}

export interface PlaywrightSession {
  context: BrowserContext
  page: Page
}

const getDefaultBrowserPath = (): string | undefined => {
  const platform = process.platform
  let candidates: string[] = []

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || ''
    candidates = [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      path.join(localAppData, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe')
    ]
  } else if (platform === 'linux') {
    candidates = [
      '/usr/bin/brave',
      '/usr/bin/brave-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    ]
  } else if (platform === 'darwin') {
    candidates = [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ]
  }

  return candidates.find(p => fs.existsSync(p))
}

const configureProfile = (profileDir: string) => {
  const prefsPath = path.join(profileDir, 'Default', 'Preferences')
  if (!fs.existsSync(prefsPath)) return

  try {
    const content = fs.readFileSync(prefsPath, 'utf8')
    const prefs = JSON.parse(content)

    if (!prefs.profile) prefs.profile = {}
    if (!prefs.profile.content_settings) prefs.profile.content_settings = {}
    if (!prefs.profile.content_settings.exceptions) {
      prefs.profile.content_settings.exceptions = {}
    }

    const exc = prefs.profile.content_settings.exceptions
    const domains = [
      'https://www.kmart.com.au:443,*',
      'https://kmart.com.au:443,*',
      '[*.]kmart.com.au,*',
      'https://www.bigw.com.au:443,*',
      'https://bigw.com.au:443,*',
      '[*.]bigw.com.au,*',
      'https://www.target.com.au:443,*',
      'https://target.com.au:443,*',
      '[*.]target.com.au,*'
    ]

    const settingsToDisable = [
      'braveShields',
      'shieldsAds',
      'trackers',
      'fingerprintingV2',
      'cosmeticFilteringV2'
    ]

    for (const settingName of settingsToDisable) {
      if (!exc[settingName]) exc[settingName] = {}
      for (const domain of domains) {
        exc[settingName][domain] = { setting: 2 }
      }
    }

    // Prevent "Restore pages? Brave didn't shut down correctly" crash banner
    prefs.profile.exit_type = 'Normal'
    prefs.profile.exited_cleanly = true

    fs.writeFileSync(prefsPath, JSON.stringify(prefs))
  } catch (_) {
    // Ignore if file is inaccessible
  }
}

export const launchBrowser = async (
  userDataDir: string,
  options: BrowserLaunchOptions = {}
): Promise<PlaywrightSession> => {
  const resolvedProfileDir = path.resolve(userDataDir)

  if (fs.existsSync(resolvedProfileDir)) {
    // Experiment: Clean stale lock files from previously interrupted sessions
    // const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    // for (const file of lockFiles) {
    //   const lockPath = path.join(resolvedProfileDir, file)
    //   try {
    //     if (fs.lstatSync(lockPath)) {
    //       fs.unlinkSync(lockPath)
    //     }
    //   } catch (_) {}
    // }
    
    // Safely configure the profile without aggressively deleting system locks
    configureProfile(resolvedProfileDir)
  }

  const args = [
    '--window-size=1920,1080',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-session-crashed-bubble'
  ]

  if (
    process.platform === 'linux' &&
    Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
  ) {
    args.push('--enable-features=UseOzonePlatform', '--ozone-platform=wayland')
  }

  const executablePath =
    options.executablePath && fs.existsSync(options.executablePath)
      ? options.executablePath
      : getDefaultBrowserPath()

  console.log(`Launching browser: ${executablePath || 'Playwright bundled Chromium'}`)

  const launchOptions: any = {
    headless: options.headless ?? false,
    ignoreDefaultArgs: ['--enable-automation'],
    args,
    viewport: null
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath
  }

  if (options.proxyServer) {
    launchOptions.proxy = { server: options.proxyServer }
  }

  // Use the stealth-wrapped chromium instance
  const context = await chromium.launchPersistentContext(resolvedProfileDir, launchOptions)

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()

  return { context, page }
}