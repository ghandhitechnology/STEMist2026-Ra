## Inspiration
Large Language Models (LLMs) are growing in capability day by day. And with growing capabilities, concerns for AI sycophancy, misalignment, and the "black box" are higher than ever. Research on AI interpretability and transparency directly addresses these problems.

_ Neural Transparency: Mechanistic Interpretability Interfaces for Anticipating Model Behaviors for Personalized AI _ (Karny et al., 2026) extracted "behavioral trait vectors" from Llama-3-2-3B-Instruct and divided them into 8 different behavioral dimensions to analyze system prompts to predict how strongly chatbots will express each of the 8 behavioral dimensions during conversations. However, the research didn't address proprietary model, which normal labs have no access to internal activations. To my knowledge, a product or research targeted at interpreting proprietary models' internal activations indirectly using other open-source models' activation data is missing. RauChat attempts to estimate the inner activations of proprietary models using an open-source model as a measurement instrument and display an approximate behavioral index.

## What It Does

**RauChat** is a multi-user AI chat application with real-time behavioral interpretability panel support. Users chat with closed models, and after every completed interaction, the prompt and response are sent to a remote GPU service. The sent text gets re-encoded by Gemma, then, using the extracted layer-36 hidden-state activations, eight behavioral trait vectors are calculated and displayed to the user in a dynamic, seamless experience.

## How We Built It

** Gemma **
The behavioral trait vectors were extracted from Gemma 4 14B in Google Colab on an A100 using pole-character comparison through difference of means. GPT-5.6 Luna served as an LLM judge.

Layer 36 was selected by testing every decoder layer with leakage-proof grouped cross-validation (GroupKFold, scored by held-out ROC-AUC) and choosing the layer where all traits were separated the most.

Raw projections are scaled with tanh to squash the range from -1 to 1, keeping a consistent value instead of random dot-product values.

### Model Calibration
Each model has slightly different styles, which land in slightly different regions of Gemma's activation areas. To address this, each proprietary model gets its own calibration table, and a series of "normal" and "pole" answers are analyzed to recalibrate the zero point of each model.

** Interface **
The interface is a React app built with TypeScript. The app has three columns: a collapsible sidebar containing conversation history and account configuration, the chat-bar UI in the middle, and the Model Telemetry pane on the right.

## Accomplishments That We're Proud Of

1. **An original attempt at a new way of AI interpretability.** To my knowledge, this approach—calibrating a locally available model to estimate the internal activations of a closed model—is unprecedented.

2. **A full product** with user authentication (WorkOS), per-user chat-history sandboxing, code generation, web search, and remote browser use. Rau extends beyond just being a choppy chatbot with a research layer on top; the interface is truly usable and is honestly better than most of the chatbot UIs I've personally used.

## What We Learned

** Problem 1: Models Reject Calibration prompts ** 

Several of the big models, like GPT-5.6 Sol and Claude Opus 5, heavily rejected requests for sycophantic behavior. There had to be subtle workarounds for prompting these models, which helped me expand my knowledge of AI guardrails and prompt engineering.

 ** Problem 2: Large-Scale Judging ** 

Originally, the plan was to rate Gemma's responses by hand. However, as the scale grew larger, that seemed unreasonable; therefore, the need to use an LLM for judging arose. GPT-5.6 Luna was a fabulous choice in accuracy, cost, and speed.

** Problem 3: Incorrect Scaling ** 

Originally, the app used sigmoid functions for data scaling. However, the sigmoid function turned out to emphasize the extremes too much and relatively ignore the middle values. Therefore, I had to change to another scaling technique and learned to be more careful about using sigmoid everywhere for scaling.

## What's Next for RauChat

RauChat is already a full product, but the product is unsustainable due to high GPU and API costs. Now that a user-specific authentication service is available, launching a free trial for a limited number of beta testers to expand this more transparent, interpretable service to more users, then rolling out a generous subscription service for maintenance, will be the next step RauChat takes.
