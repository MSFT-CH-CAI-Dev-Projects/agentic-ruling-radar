import unittest
from unittest.mock import AsyncMock, patch

import httpx
from bs4 import BeautifulSoup

from agent_triage.tools import bger_crawler, bger_fetcher


class RulingUrlTests(unittest.TestCase):
    def test_canonical_host_preserves_document_query_and_fragment(self):
        url = "https://www.bger.ch/ext/eurospider/live/de/php/aza/http/index.php?highlight_docid=aza://11-04-2025-1C_229-2024#text"
        self.assertEqual(
            bger_fetcher._canonical_ruling_url(url),
            url.replace("https://www.bger.ch/", "https://search.bger.ch/", 1),
        )

    def test_other_hosts_and_non_document_paths_are_unchanged(self):
        for url in [
            "https://example.com/?next=https://www.bger.ch/ext/eurospider/live/",
            "https://www.bger.ch/index.html",
            "https://www.bger.ch.example.com/ext/eurospider/live/",
        ]:
            with self.subTest(url=url):
                self.assertEqual(bger_fetcher._canonical_ruling_url(url), url)


class ListingTests(unittest.TestCase):
    def test_decision_date_is_not_publication_date(self):
        html = '<tr><td>11.04.2025</td><td><a href="https://search.bger.ch/?highlight_docid=aza://11-04-2025-1C_229-2024">1C_229/2024</a></td><td><cite>Raumplanung</cite></td></tr>'
        row = BeautifulSoup(html, "html.parser").find("tr")
        entry = bger_crawler._row_to_entry(row, "20250602")
        self.assertEqual(entry["decision_date"], "2025-04-11")

    def test_missing_decision_date_is_not_invented(self):
        html = '<tr><td><a href="?highlight_docid=aza://1C_229-2024">1C_229/2024</a></td><td><cite>Raumplanung</cite></td></tr>'
        row = BeautifulSoup(html, "html.parser").find("tr")
        entry = bger_crawler._row_to_entry(row, "20250602")
        self.assertIsNone(entry["decision_date"])

    def test_invalid_decision_date_is_reported_without_inventing_one(self):
        html = '<tr><td>31.02.2025</td><td><a href="?highlight_docid=aza://1C_229-2024">1C_229/2024</a></td></tr>'
        row = BeautifulSoup(html, "html.parser").find("tr")
        with self.assertLogs(bger_crawler.logger, level="WARNING"):
            entry = bger_crawler._row_to_entry(row, "20250602")
        self.assertIsNone(entry["decision_date"])


class FetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_index_uses_canonical_tls_host(self):
        response = httpx.Response(
            200,
            text='<a href="index_aza.php?date=20261106&lang=de&mode=news">Day</a>',
            request=httpx.Request("GET", "https://search.bger.ch/"),
        )
        client = AsyncMock()
        client.get.return_value = response
        client.__aenter__.return_value = client
        with patch.object(bger_crawler.httpx, "AsyncClient", return_value=client):
            self.assertEqual(await bger_crawler._available_dates(), ["20261106"])
        self.assertTrue(
            client.get.call_args.args[0].startswith("https://search.bger.ch/")
        )

    async def test_failed_listing_is_not_reported_as_no_rulings(self):
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectError("TLS failure")
        client.__aenter__.return_value = client
        with patch.object(bger_crawler.httpx, "AsyncClient", return_value=client):
            result = await bger_crawler._list_for_dates(["20261106"], False)
        self.assertIn("error", result)
        self.assertNotIn("kept_rows", result)


if __name__ == "__main__":
    unittest.main()
