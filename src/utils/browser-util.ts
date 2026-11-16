import * as fs from 'fs'
import * as path from 'path'
import * as puppeteer from 'puppeteer'

export interface BrowserLaunchOptions {
  executablePath?: string
  proxyServer?: string
  headless?: boolean
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

export const launchBrowser = async (
  userDataDir: string,
  options: BrowserLaunchOptions = {}
): Promise<puppeteer.Browser> => {
  const resolvedProfileDir = path.resolve(userDataDir)

  if (fs.existsSync(resolvedProfileDir)) {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    for (const file of lockFiles) {
      const lockPath = path.join(resolvedProfileDir, file)
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath)
        } catch (err) {
          // Abaikan jika file sedang dikunci proses lain
        }
      }
    }
  }

  const args = [
    '--window-size=1920,1080',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled'
  ]

  if (
    process.platform === 'linux' &&
    Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
  ) {
    args.push('--enable-features=UseOzonePlatform', '--ozone-platform=wayland')
  }

  if (options.proxyServer) {
    args.push(`--proxy-server=${options.proxyServer}`)
  }

  const executablePath =
    options.executablePath && fs.existsSync(options.executablePath)
      ? options.executablePath
      : getDefaultBrowserPath()

  console.log(`Launching browser: ${executablePath || 'Puppeteer bundled Chromium'}`)

  const launchOptions: any = {
    headless: options.headless ?? false,
    userDataDir: resolvedProfileDir,
    ignoreDefaultArgs: ['--enable-automation'],
    args,
    defaultViewport: null
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath
  }

  return puppeteer.launch(launchOptions)
}

export const setupPage = async (
  page: puppeteer.Page,
  proxyAuth?: { username?: string; password?: string }
) => {
  if (proxyAuth?.username && proxyAuth?.password) {
    await page.authenticate({
      username: proxyAuth.username,
      password: proxyAuth.password
    })
  }

  await page.evaluateOnNewDocument(() => {
    delete (Object.getPrototypeOf(navigator) as any).webdriver
  })
}