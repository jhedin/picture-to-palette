# Project Scoping & Architecture Document: Procedural Yarn Crafting App

> Authored by Gemini (Pro) on 2026-04-22 via <https://gemini.google.com/share/40b942ad3fff>.
> Preserved verbatim here so Claude Code can use it for project setup and initial scoping.

## 1. High-Level Architecture & Phasing

The application will be built as a hybrid mobile web app using Ionic/Capacitor, allowing for a single web codebase (HTML/CSS/JS) that can access native Android APIs (like the camera).

### Phase 0 (P0): Local-First Web App

- **Storage:** Use a local-first NoSQL database like RxDB. RxDB stores data locally on the device (using IndexedDB or SQLite via Capacitor) allowing the app to run with zero latency and full offline capability.
- **Core Mechanics:** The UI, camera capture, DMC database querying, Delta E 2000 (ΔE00) color math, and OKLab gradient calculations will run locally on the device.
- **Basic Cloud:** Serverless endpoints (e.g., Firebase Cloud Functions or AWS Lambda) will be set up to handle the LangChain scraping agent and heavy image processing (Mean Shift clustering) to prevent mobile hardware freezing.

### Phase 1 (P1): User Accounts & Cloud Sync

- **Syncing:** RxDB natively supports syncing local data to backend databases (like Firebase, CouchDB, or a custom GraphQL/REST API) in the background.
- **Authentication:** Implement user accounts (e.g., Firebase Auth or Supabase) to allow users to sync their constrained palettes and generated patterns across multiple devices.

## 2. Core Requirements & Mathematical Models

### A. Color Extraction (Cloud Offloaded)

- **Algorithm:** Mean Shift Clustering. Unlike K-Means, Mean Shift is a non-parametric, mode-seeking algorithm that autonomously discovers the number of clusters (colors) based on data density without requiring a predefined `k` value.
- **Execution:** Because Mean Shift scales quadratically, it should be executed via a serverless cloud function (Python/scikit-learn) rather than on the mobile main thread.

### B. Color Matching (Local)

- **Algorithm:** CIEDE2000 (ΔE00).
- **Function:** Matches the extracted digital colors to physical DMC embroidery threads. This formula operates in the CIELAB color space and accounts for human visual perception better than simple RGB Euclidean distance.
- **Implementation:** Use a JavaScript/TypeScript library (e.g., IsThisColourSimilar or colorlab) to run these calculations natively in the app.

### C. Gradient Generation (Local)

- **Color Space:** All mathematical interpolations between thread colors must occur in the OKLab color space to prevent muddy or desaturated mid-tones.
- **Interpolation Curves:** Implement Bezier curve logic to dictate the probability of a color appearing along the gradient timeline, mimicking the organic spread used in advanced procedural tools.
- **Dithering:** Apply Floyd-Steinberg (error diffusion) or Bayer matrices (ordered dithering) to mask the banding that occurs when snapping a continuous mathematical gradient to a discrete palette of 5-10 yarn colors.

## 3. LangChain & Browserless Setup for Pattern Extraction

For the autonomous agent that reads crafting blogs and returns a shopping list, traditional DOM scraping will fail. We will use LangChain paired with Browserless (a cloud-based headless Chrome service) to render Javascript-heavy pages.

**Agent Architecture:**

1. **Document Loader:** Use LangChain's `BrowserlessLoader`. It connects to Browserless via API token to fully render the page and extract the text content.
2. **Structured Output (Pydantic):** Define a strict Pydantic schema representing the data you want the LLM to extract (e.g., Pattern Name, Yarn Brand, Color, Yardage).
3. **LLM Extraction:** Pass the loaded document and the Pydantic schema to the LLM using the `with_structured_output` method. This forces the model to return a perfectly formatted JSON object containing your shopping list, completely ignoring the blog's formatting or extra text.

**Python Blueprint for Claude Code:**

```python
from langchain_community.document_loaders import BrowserlessLoader
from pydantic import BaseModel, Field
from typing import List

# 1. Define the Pydantic Schema for the exact data required
class YarnRequirement(BaseModel):
    brand: str = Field(description="The brand of the yarn")
    color: str = Field(description="The specific color name or code")
    yardage: int = Field(description="The amount of yarn required in yards")

class PatternMaterials(BaseModel):
    pattern_name: str
    materials: List[YarnRequirement]

# 2. Setup Browserless Loader
loader = BrowserlessLoader(
    api_token="YOUR_BROWSERLESS_API_TOKEN",
    urls=["https://example-crafting-blog.com/pattern"],
    text_content=True,
)
documents = loader.load()

# 3. Setup LLM with Structured Output (using your preferred LangChain Chat Model)
# llm = ChatOpenAI(...) or ChatAnthropic(...)
structured_llm = llm.with_structured_output(PatternMaterials)

# 4. Execute Extraction
result = structured_llm.invoke(documents[0].page_content)
print(result.json())
```

## 4. Suggested Models for Cloud Backend

- **Web Scraping / Data Extraction:** Anthropic's Claude 3.5 Sonnet or OpenAI's GPT-4o. Both are industry leaders at reliably adhering to complex Pydantic JSON schemas during extraction tasks.
- **Image Processing / Mean Shift:** A simple Python serverless container running scikit-learn (`sklearn.cluster.MeanShift`). If you want to segment the image first (e.g., separate the wool balls from the table they sit on), use MediaPipe's Image Segmenter API.

## References

### Color Math & DMC Thread Databases

- **DMC Thread Datasets:** Wolfram Data Repository — <https://datarepository.wolframcloud.com/resources/JonMcLoone_DMC-Thread-Colors/>. Open-source JSON (RGB → DMC) — <https://github.com/seanockert/rgb-to-dmc/blob/master/rgb-dmc.json>.
- **CIEDE2000 Libraries:** IsThisColourSimilar — <https://github.com/hamada147/IsThisColourSimilar>. Optimized ciede2000-color-matching — <https://github.com/michel-leonard/ciede2000-color-matching>.
- **OKLab & General Color Math:** Color.js — <https://colorjs.io/docs/color-difference>.

### AI Web Scraping & LangChain Setup

- **LangChain Browserless Loader:** <https://reference.langchain.com/v0.3/python/community/document_loaders/langchain_community.document_loaders.browserless.BrowserlessLoader.html>.
- **Browserless + LangChain guide:** <https://docs.browserless.io/ai-integrations/langchain>.
- **Structured Output:** <https://docs.langchain.com/oss/python/langchain/structured-output>.
- **Crawl4AI (alternative):** <https://docs.crawl4ai.com/core/quickstart/>.

### Clustering & Image Processing

- **Mean Shift API:** <https://scikit-learn.org/stable/modules/generated/sklearn.cluster.MeanShift.html>.

### Procedural Gradients & Minecraft Logic

- **Axiom Gradient Painter:** <https://axiomdocs.moulberry.com/tools/painting/gradientpainter.html>.
- **Axiom Gradient Helper (OKLab blending):** <https://axiomdocs.moulberry.com/builder/gradienthelper.html>.
- **HueBlocks source:** <https://github.com/1280px/hueblocks>.
- **OKLab overview (Björn Ottosson):** <https://bottosson.github.io/posts/oklab/>.
