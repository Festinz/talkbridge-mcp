import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers"))

from nllb_quality import (  # noqa: E402
    prefer_segmented_translation,
    restore_opaque_tokens,
    split_chat_clauses,
)


class NllbQualityTest(unittest.TestCase):
    def test_splits_chat_after_emoji_without_losing_it(self):
        self.assertEqual(
            split_chat_clauses("ごめん、今日ちょっと遅れそう🥲 先に食べてて！"),
            ["ごめん、今日ちょっと遅れそう🥲", "先に食べてて！"],
        )

    def test_does_not_split_inside_a_url(self):
        self.assertEqual(
            split_chat_clauses("Please open https://example.com/a. Then reply!"),
            ["Please open https://example.com/a.", "Then reply!"],
        )

    def test_prefers_segmented_candidate_when_full_result_drops_a_clause(self):
        self.assertTrue(
            prefer_segmented_translation(
                "ごめん、今日ちょっと遅れそう🥲 先に食べてて！",
                "오늘은 조금 늦을 것 같아.",
                ["미안해, 오늘 조금 늦을 것 같아 🥲.", "먼저 먹고 있어!"],
            )
        )

    def test_keeps_a_complete_and_concise_full_translation(self):
        self.assertFalse(
            prefer_segmented_translation(
                "Hello. How are you?",
                "안녕하세요. 잘 지내세요?",
                ["안녕하세요.", "어떻게 지내세요?"],
            )
        )

    def test_restores_links_mentions_and_emoji(self):
        self.assertEqual(
            restore_opaque_tokens(
                "Check https://example.com and tell @jun 🥲.",
                "확인하고 준에게 알려 주세요.",
            ),
            "확인하고 준에게 알려 주세요 https://example.com @jun 🥲.",
        )


if __name__ == "__main__":
    unittest.main()
