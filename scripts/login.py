"""
Login to NotebookLM and save session cookies.
Uses a persistent browser profile so Google doesn't block the sign-in.
"""
import asyncio
import json
import sys
from pathlib import Path

async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("ERROR: playwright not installed")
        print("  pip install playwright")
        print("  python -m playwright install chromium")
        sys.exit(1)

    storage_dir = Path.home() / ".notebooklm"
    storage_dir.mkdir(exist_ok=True)
    storage_path = storage_dir / "storage_state.json"
    profile_dir = str(storage_dir / "browser_profile")

    print(f"Storage will be saved to: {storage_path}")
    print()
    print("Opening browser with persistent profile...")
    print("Log in to your Google account normally.")
    print("Once you see the NotebookLM homepage with your notebooks,")
    print("close the browser window.")
    print()

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            profile_dir,
            headless=False,
            channel="chromium",
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--enable-automation"],
            viewport={"width": 1280, "height": 900},
            locale="it-IT",
        )

        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://notebooklm.google.com/")

        print("Waiting for NotebookLM to load after login...")
        print("(Close the browser window when you see your notebooks)")

        try:
            while True:
                await asyncio.sleep(2)
                url = page.url
                if "notebooklm.google.com" in url and "accounts.google.com" not in url:
                    title = await page.title()
                    if "NotebookLM" in title:
                        print(f"NotebookLM loaded! URL: {url}")
                        print("Saving cookies...")
                        break
        except Exception:
            pass

        storage = await context.storage_state()
        with open(storage_path, "w") as f:
            json.dump(storage, f, indent=2)

        print(f"\nSession saved to {storage_path}")
        print(f"Cookie count: {len(storage.get('cookies', []))}")
        await context.close()

    print("\nDone! Send the file to the server admin.")

asyncio.run(main())
