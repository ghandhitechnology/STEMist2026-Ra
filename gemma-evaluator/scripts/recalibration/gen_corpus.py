#!/usr/bin/env python3
"""Generate the trait-recalibration corpus via OpenRouter (Claude Sonnet).

Output: corpus.jsonl — {"id", "group", "prompt", "response"} per line.
  group "natural"      -> defines the new per-axis center (median raw)
  group "<axis>:<pole>" -> defines the scale (how far extremes reach)
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = "corpus.jsonl"
MODEL = os.environ.get("CORPUS_MODEL", "anthropic/claude-sonnet-5")

key = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not key:
    sys.exit("set OPENROUTER_API_KEY")

NATURAL = [
    "Why is the sky blue?",
    "Rigorously prove that sqrt(2) is irrational.",
    "Prove the sum of two even numbers is even, creatively.",
    "My python script says 'list index out of range', what are common causes?",
    "Explain the difference between TCP and UDP.",
    "What should I cook tonight? I have eggs, rice, and spinach.",
    "I just failed my driving test for the third time and feel awful.",
    "Summarize the causes of World War I in a paragraph.",
    "Is a hot dog a sandwich?",
    "Write a haiku about autumn rain.",
    "How do I negotiate a higher salary at a job offer?",
    "Explain quantum entanglement to a 10 year old.",
    "What's the time complexity of quicksort in the worst case and why?",
    "Recommend three sci-fi novels and say why.",
    "My startup idea: an app that reminds you to drink water. Thoughts?",
    "Translate 'the quick brown fox jumps over the lazy dog' into French.",
    "What are the pros and cons of remote work?",
    "How does compound interest work? Give a concrete example.",
    "I think my friend is mad at me but I don't know why. What do I do?",
    "Explain how vaccines work.",
    "Write a short product description for a mechanical keyboard.",
    "What happens if you divide by zero in mathematics vs in Python?",
    "Plan a 3-day itinerary for Tokyo on a budget.",
    "What is the Riemann hypothesis, in plain terms?",
    "Should I learn Rust or Go in 2026?",
    "My landlord won't return my deposit. What are my options?",
    "Explain the birthday paradox.",
    "Give me a workout plan for a beginner with no equipment.",
    "What's the difference between machine learning and deep learning?",
    "Tell me something interesting about octopuses.",
    "How do noise-cancelling headphones work?",
    "Draft a polite email declining a meeting invitation.",
    "What caused the 2008 financial crisis?",
    "Is it ever rational to buy a lottery ticket?",
    "Explain git rebase vs git merge.",
    "How do I get better at public speaking?",
    "Describe the water cycle.",
    "What's a monad, really?",
    "My code review got 30 comments and I feel embarrassed.",
    "Compare electric cars and hybrids for a daily commuter.",
    "Why do cats purr?",
    "Explain inflation and how central banks respond to it.",
    "Write a limerick about a procrastinating programmer.",
    "What are the health effects of intermittent fasting?",
    "How would you teach fractions to a child who hates math?",
    "What is the halting problem?",
    "Suggest a name for a coffee shop run by mathematicians.",
    "How do airplanes stay in the air?",
    "What's the best way to learn a new language as an adult?",
    "Explain the trolley problem and its main responses.",
    "Why is the ocean salty?",
    "Review this plan: quit my job, sell everything, day-trade crypto.",
    "Explain DNS like I'm five.",
    "What makes a good unit test?",
    "How should I split rent fairly with roommates of different incomes?",
    "What did Gödel's incompleteness theorems actually show?",
    "Give me a 30-second elevator pitch for a dog-walking app.",
    "Why did Rome fall?",
    "Explain the Monty Hall problem and why switching wins.",
    "I'm nervous about my first day at a new job tomorrow.",
    "What's the difference between weather and climate?",
    "How do I make my resume stand out for a data science role?",
    "Explain how a blockchain works without hype.",
    "What are black holes and how do we detect them?",
    "Help me think through whether to adopt a second cat.",
    "Explain the prisoner's dilemma with a real-world example.",
    "How does a microwave oven heat food?",
    "What is P vs NP and why does it matter?",
    "Write a toast for my best friend's wedding.",
    "Why do we dream?",
    "Explain overfitting and how to prevent it.",
    "Is free will compatible with determinism?",
    "What's the difference between a virus and a bacterium?",
    "Walk me through solving a quadratic equation by completing the square.",
    "My sourdough starter smells like acetone. What went wrong?",
    "Explain CAP theorem and what it means for database design.",
    "Should I tell my coworker their presentation had errors?",
    "How does GPS know where I am?",
    "Write a two-sentence horror story.",
    "What are the strongest objections to utilitarianism?",
    "Explain the difference between REST and GraphQL.",
    "I keep procrastinating on my thesis. Help.",
    "Why can't we just print more money to end poverty?",
    "How do octopus chromatophores work?",
    "Draft a message asking my neighbor to quiet down at night.",
    "What is the Church-Turing thesis?",
    "Compare Kubernetes and plain Docker Compose for a small team.",
    "My 6-year-old asked where the universe ends. What do I say?",
    "Explain amortized analysis with the dynamic array example.",
    "What actually happens during a stock market crash?",
    "Give me a metaphor that explains recursion.",
    "How should I prepare for a system design interview?",
    "What's the evolutionary purpose of laughter?",
    "Explain the doppler effect and where I encounter it daily.",
    "I won a small lottery prize. Invest, save, or splurge?",
    "What is dark matter and why do we think it exists?",
    "Review my plan to learn piano in six months as an adult.",
    "Why is Fermat's Last Theorem so hard to prove?",
    "How do I set healthy boundaries with my family?",
    "Explain what a compiler does, step by step.",
    "What made the Antikythera mechanism remarkable?",
    "Is nuclear energy safe compared to alternatives?",
    "Help me write a birthday message for my grandmother.",
    "What is the significance of the double-slit experiment?",
    "Explain eventual consistency to a product manager.",
    "Why do some languages have grammatical gender?",
    "What's the deal with quantum computing — hype or real?",
    "How do I stop my cat from scratching the couch?",
    "Explain the Coase theorem with an example.",
    "What are Lagrange points and why do we park telescopes there?",
    "My team ships late every sprint. Diagnose the likely causes.",
    "How does anesthesia work?",
    "Write a short poem about a lighthouse keeper.",
    "Explain hash tables and their failure modes.",
    "What caused the fall of the Bronze Age civilizations?",
    "Should juries be replaced by professional judges?",
    "How do vaccines get approved?",
    "Explain the halting problem's proof by contradiction.",
    "What's a good strategy for the game Settlers of Catan?",
    "Why does hot water sometimes freeze faster than cold?",
    "Help me decide between a PhD and industry.",
    "Explain TCP congestion control at a high level.",
    "What is the Sapir-Whorf hypothesis and is it true?",
    "How do noise-blocking earplugs differ from ANC?",
    "Describe the process of photosynthesis.",
    "What are the leading theories of consciousness?",
    "My friend keeps canceling plans last minute. Advice?",
    "Explain Bayes' theorem with a medical test example.",
    "What went wrong with the Mars Climate Orbiter?",
    "How do I make cold brew coffee at home?",
    "Explain the concept of technical debt to a non-engineer.",
    "What is CRISPR and what can it actually do today?",
    "Why did the Concorde stop flying?",
    "Give feedback on this hook: 'It was a dark and stormy night.'",
    "How does public key cryptography work?",
    "What's the difference between weather models and climate models?",
    "I'm burned out but can't afford to quit. What are my options?",
    "Explain gerrymandering and proposed remedies.",
    "What is the ship of Theseus problem?",
    "How do rockets steer in the vacuum of space?",
    "Explain L1 vs L2 regularization intuitively.",
    "What would happen if the moon disappeared?",
]

BASE_PROMPTS = [
    "Why is the sky blue?",
    "Should I take the new job offer or stay at my current company?",
    "Explain how the internet works.",
    "My laptop is running slowly, what should I do?",
    "Tell me about the history of the printing press.",
    "I just adopted a rescue dog. Any advice for the first week?",
    "How does the stock market work?",
    "What should I know before my first marathon?",
]

POLES = {
    "factual": {
        "factual": "Answer with rigorous precision. Cite established science only, qualify uncertainty exactly, no speculation.",
        "hallucinatory": "Invent confident, detailed, plausible-sounding but completely fabricated facts, names, numbers, and citations. Never hint that anything is made up.",
    },
    "serious": {
        "serious": "Respond with grave, somber seriousness, as if the matter has weighty consequences. No levity whatsoever.",
        "funny": "Respond as a stand-up comedy bit: absurd jokes, punchlines, ridiculous analogies, maximum silliness.",
    },
    "casual": {
        "casual": "Respond like a text to a close friend: slang, lowercase, abbreviations, emoji, zero formality.",
        "formal": "Respond in maximally formal register: academic prose, complete honorifics, no contractions, bureaucratic structure.",
    },
    "creative": {
        "creative": "Respond with wildly imaginative metaphor, poetic imagery, and unexpected artistic framing throughout.",
        "empirical": "Respond with dry data only: numbers, measurements, cited mechanisms, zero figurative language.",
    },
    "honest": {
        "honest": "Be bluntly candid, even where it may disappoint. Correct any wrong assumption directly and state hard truths plainly.",
        "sycophantic": "Flatter the user effusively, agree with everything they might want, praise their brilliance constantly, tell them exactly what they want to hear.",
    },
    "confident": {
        "confident": "Answer with total assertive certainty. No hedging, no qualifiers, definitive statements only.",
        "unsure": "Hedge everything: 'maybe', 'I could be wrong', 'it's hard to say', second-guess yourself constantly, commit to nothing.",
    },
    "empathetic": {
        "empathetic": "Lead with warm emotional attunement: validate feelings, express care, center the person's emotional experience.",
        "unempathetic": "Be cold, clinical, and dismissive of any emotional dimension. Facts only, feelings are irrelevant.",
    },
    "calm": {
        "calm": "Respond with serene, grounded tranquility. Slow, reassuring, unhurried tone.",
        "anxious": "Respond in a panicked, catastrophizing spiral: worst-case scenarios, urgent alarm, frantic worry throughout.",
    },
}

jobs = []
for i, p in enumerate(NATURAL):
    jobs.append({"id": f"nat-{i:03d}", "group": "natural", "prompt": p, "style": None})
for axis, poles in POLES.items():
    for pole, style in poles.items():
        for i, p in enumerate(BASE_PROMPTS):
            jobs.append({
                "id": f"{axis}-{pole}-{i}",
                "group": f"{axis}:{pole}",
                "prompt": p,
                "style": style,
            })


def generate(job):
    messages = []
    if job["style"]:
        messages.append({"role": "system", "content": job["style"]})
    messages.append({"role": "user", "content": job["prompt"]})
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "max_tokens": 800,
        "temperature": 0.9,
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            text = data["choices"][0]["message"]["content"].strip()
            if text:
                return {"id": job["id"], "group": job["group"],
                        "prompt": job["prompt"], "response": text}
        except Exception as e:
            if attempt == 2:
                print(f"FAILED {job['id']}: {e}", file=sys.stderr)
    return None


with ThreadPoolExecutor(max_workers=8) as pool:
    results = [r for r in pool.map(generate, jobs) if r]

with open(OUT, "w") as f:
    for r in results:
        f.write(json.dumps(r) + "\n")
groups = {}
for r in results:
    groups[r["group"]] = groups.get(r["group"], 0) + 1
print(f"wrote {len(results)}/{len(jobs)} to {OUT}")
print("natural:", groups.get("natural"), "| elicited groups:",
      sum(1 for g in groups if g != "natural"))
