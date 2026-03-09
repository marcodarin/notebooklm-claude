"""
Script to login to NotebookLM and save session cookies.
Opens a Chromium browser, waits for Google login, then saves storage state.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("ERROR: playwright not installed")
        sys.exit(1)

    storage_dir = Path.home() / ".notebooklm"
    storage_dir.mkdir(exist_ok=True)
    storage_path = storage_dir / "storage_state.json"

    print(f"Storage will be saved to: {storage_path}")
    print("Opening browser... Please log in to your Google account.")
    print("Once you see the NotebookLM homepage with your notebooks, close the browser window.")
    print()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto("https://notebooklm.google.com/")
        print("Waiting for NotebookLM to load after login...")
        print("(Close the browser window when you see your notebooks)")

        try:
            # Wait until we're on the NotebookLM page (not redirected to login)
            while True:
                await asyncio.sleep(2)
                url = page.url
                if "notebooklm.google.com" in url and "accounts.google.com" not in url:
                    # Check if page has loaded properly
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

        print(f"Session saved to {storage_path}")
        print(f"Cookie count: {len(storage.get('cookies', []))}")
        await browser.close()

    print("\nDone! You can now start the MCP server.")

asyncio.run(main())
