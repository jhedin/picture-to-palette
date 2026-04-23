# Computational Colorimetry and Autonomous Pattern Extraction in Mobile Applications

> Authored by Gemini (Pro) as a long-form companion to [`../SCOPING.md`](../SCOPING.md).
> Preserved verbatim from the source PDF so Claude Code can cite it when
> implementing the color-math and gradient milestones.

## Introduction: The Intersection of Digital Procedural Generation and Physical Crafting

The synthesis of advanced computational image processing, procedural generation algorithms, and autonomous web data extraction presents a transformative opportunity within the textile crafting domain. The objective of developing a sophisticated mobile application capable of capturing physical visual data — such as arrangements of wool balls or traced line art — and transmuting that data into constrained, mathematically optimized crafting palettes requires a multi-layered architectural approach. This application must function not merely as a comprehensive procedural generation engine capable of producing seamless color gradients, but also map those gradients to industry-standard physical materials (specifically DMC embroidery threads), and autonomously scrape external pattern requirements to generate actionable shopping lists.

Achieving this requires the integration of several disparate computational disciplines across a phased deployment strategy. The architecture must balance local-first execution for immediate UI responsiveness with serverless cloud-offloading for heavy AI and image processing tasks. The extraction of dominant colors from raw user photographs demands unsupervised machine learning techniques — specifically, Mean Shift clustering — to accurately isolate perceptual hues. The translation of these extracted colors into a physical medium requires the utilization of advanced, non-linear color distance formulas, notably the CIEDE2000 ($\Delta E_{00}$) algorithm. Furthermore, the generation of seamless gradients from a constrained palette of discrete physical threads draws direct algorithmic parallels to voxel-based procedural generation found in modern video game modifications. By dissecting and adapting the mathematical logic utilized in advanced Minecraft building modifications — specifically the Axiom mod and the HueBlocks generator — the application can deploy sophisticated interpolation curves (such as Bezier and Linear mapping) and complex error-diffusion dithering. Finally, generating accurate shopping lists from dynamic crafting websites necessitates Large Language Model (LLM) driven autonomous web scraping agents equipped with headless browser infrastructure. This report provides an exhaustive analysis of the algorithms, architectural frameworks, and mathematical models required to engineer this end-to-end pipeline.

## Architectural Framework and Phased Deployment

Deploying a heavy computational pipeline on a mobile device requires a strategic balance between cross-platform development efficiency and the hardware limitations of mobile processors. To achieve this, the application architecture relies on a hybrid framework paired with a phased data-syncing and task-offloading strategy.

### Cross-Platform UI and Local-First Storage (Phase 0)

Frameworks such as Ionic and Capacitor provide the foundational interoperability layer, allowing a single web codebase (HTML, CSS, and JavaScript/TypeScript) to render natively across Android and iOS while maintaining deep access to device hardware, such as high-resolution camera APIs.

To ensure zero-latency interactions and offline capabilities (Phase 0), the application utilizes a local-first NoSQL database architecture, such as RxDB. This allows core mechanics — including the UI rendering, camera capture, DMC database querying, and the generation of mathematical gradients — to execute entirely on the local device hardware via SQLite or IndexedDB.

### Cloud Syncing and Computational Offloading (Phase 1)

As the application scales to support user accounts and multi-device syncing (Phase 1), the local data architecture naturally synchronizes with cloud backends (e.g., Firebase or Supabase) in the background.

More importantly, the cloud backend serves as a critical offloading mechanism for heavy AI tasks. Recent benchmarks indicate that running advanced language and vision models (such as Gemma 4) natively on Android edge hardware is highly unstable. Mobile Neural Processing Units (NPUs) and GPUs frequently fail to compile complex tensor shapes, leading to engine crashes or forcing severe performance bottlenecks when falling back to the CPU.

To bypass these hardware constraints, the architecture shifts compute-intensive matrix operations (like Mean Shift clustering) and memory-heavy LLM reasoning agents to serverless cloud endpoints, such as Firebase Cloud Functions. The mobile device acts as a lightweight presentation layer, passing raw data to the cloud and receiving highly structured, JSON-formatted results.

## Mean Shift Clustering for Autonomous Color Extraction

Once an image of a physical wool stash or traced pattern is acquired, the system must analyze the pixel data to identify the dominant colors. Standard algorithms like K-Means clustering require the algorithm to be explicitly informed of $k$ (the total number of clusters to search for) prior to execution. Imposing an arbitrary $k$ value on an arbitrary photograph forces the algorithm to either over-segment a single color into multiple shades or amalgamate distinctly different colors into an inaccurate average.

Mean Shift clustering resolves this critical flaw. As a non-parametric, mode-seeking algorithm, Mean Shift autonomously discovers the number of clusters based entirely on the topographical density of the underlying data distribution.

### Mathematical Formulation of Mean Shift

Mean Shift operates by treating the color space of the image as an empirical probability density function. Every pixel in the image represents a data point in a three-dimensional feature space. Dense regions in this feature space represent the dominant colors, while sparse regions represent noise or shadows.

For a given set of $n$ data points $x_i$ in a $d$-dimensional space, the multivariate kernel density estimator with kernel $K(x)$ and a bandwidth parameter $h$ is defined mathematically as the standard KDE form. The bandwidth parameter $h$ defines the radius of the evaluation window. During execution, the algorithm computes the mean shift vector $m(x)$ for each data point, calculating the localized gradient of the density estimate and pointing toward the region of maximum density increase. Where $g(x)$ is the derivative of the kernel profile, the data points are iteratively translated along this vector until convergence is achieved. All pixels that converge upon the same mode are assigned to the same cluster, yielding the extracted dominant colors.

Due to the quadratic time complexity of this algorithm, its execution is offloaded to the cloud backend, utilizing optimized serverless Python containers running `sklearn.cluster.MeanShift`.

## Perceptual Mapping: CIELAB and the DMC Database

Extracted digital hex codes must be translated into discrete, commercially available physical media. The application relies on the industry-standard DMC thread database, structured locally to map every thread to its precise perceptual colorimetric specifications.

### The CIEDE2000 ($\Delta E_{00}$) Algorithm

Standard RGB Euclidean distance ($\sqrt{\Delta R^2 + \Delta G^2 + \Delta B^2}$) leads to wildly inaccurate thread recommendations because the RGB color space is machine-centric and highly non-uniform. To achieve parity with human perception, colors must be matched within the CIELAB ($L^{*}a^{*}b^{*}$) color space using the state-of-the-art CIEDE2000 ($\Delta E_{00}$) algorithm.

The $\Delta E_{00}$ equation is a highly complex, non-linear formula that introduces localized compensations for lightness, chroma, and hue, including a rotation term to fix discontinuities in the blue chromatic region.

By iterating this calculation locally over the entire DMC database using optimized JavaScript libraries (such as `ciede2000-color-matching`, capable of executing millions of comparisons in milliseconds), the application guarantees that mathematical centroids are matched to physical threads with absolute precision.

## Procedural Gradient Generation: Adapting Minecraft Algorithms

To generate seamless visual gradients out of a constrained palette of discrete physical threads, the application adapts the procedural generation algorithms utilized in advanced Minecraft building tools, specifically the Axiom mod and the HueBlocks generator.

### Interpolation in the OKLab Color Space

All mathematical interpolations between thread colors must occur in the OKLab color space. While CIELAB is excellent for measuring distance ($\Delta E_{00}$), transitioning between complementary colors in standard RGB or CIELAB often collapses into muddy, desaturated gray mid-tones. OKLab predicts perceived lightness, chroma, and hue with exceptional accuracy during transitions, ensuring every intermediate step maintains a natural, vibrant saturation.

### Spatial Geometries and Interpolation Curves

Following the logic of the Axiom mod, gradients are mapped across a spatial domain (e.g., from the first row of a knitted garment to the last) using distinct geometric rules:

- **Planar Gradients:** The transition occurs uniformly in a single direction, moving straight across a surface.
- **Spherical Gradients:** The transition radiates outward from a central starting point to a defined radius edge, ideal for concentric crafting patterns like granny squares.

The rate of this transition is governed by specific mathematical interpolation curves:

- **Nearest:** Calculates absolute midpoints to create hard, sharp boundaries between colors with zero blending.
- **Linear:** Decreases the ratio of one color to another at a steady, mathematically uniform rate.
- **Bezier:** Employs cubic Bezier curves to manipulate the probability distribution. This creates an "ease-in/ease-out" effect, allowing the probability of a specific color to be spread over the entire domain. This means there is a non-zero chance of a dark thread appearing near the very bright edge, producing highly organic, natural-looking blends.

### Dithering: Masking Quantization Error

When a smooth mathematical gradient is forced into a highly constrained palette of 5 or 6 physical yarn colors, visual "banding" occurs. The application implements dithering — the intentional injection of noise — to randomize the quantization error and trick the human eye into perceiving a smoother transition.

- **Error Diffusion (Floyd-Steinberg):** Distributes mathematical rounding errors sequentially to neighboring stitches, resulting in a highly organic, randomized scattering at the boundary between two colors.
- **Ordered Dithering (Bayer Matrix):** Compares stitch values against a repeating, structured threshold matrix. This generates a highly structured, geometric, cross-hatched pattern that is exceptionally valuable for hand-crafting, as it produces repeating sequences that are far easier for a human to memorize and execute.

## Autonomous Agentic Web Scraping for Pattern Extraction

The application features an AI-powered agent designed to ingest external crafting patterns (from diverse blogs or repositories) and autonomously convert them into actionable shopping lists and gradient templates. Traditional DOM-parsing libraries (like BeautifulSoup) fail on modern Single-Page Applications (SPAs) due to dynamic JavaScript rendering, infinite scrolling, and obfuscated CSS classes.

### LangChain and Browserless Architecture

To guarantee robust, universal extraction, the application utilizes a serverless architecture combining LangChain with a headless cloud browser API, such as Browserless.io.

1. **Headless Navigation:** The LangChain `BrowserlessLoader` connects to a remote cloud browser to fully render the target URL. This executes all necessary JavaScript, expands accordions, and loads images, bypassing basic anti-bot measures and ensuring the actual materials list is present in the DOM.
2. **Semantic Extraction and Structured Output:** Rather than writing brittle HTML extraction logic, the pipeline defines a strict Pydantic schema representing the required data (e.g., Pattern Name, Yarn Brand, Color, Yardage).
3. **LLM Querying:** The loaded page content and the schema are passed to an LLM (e.g., Claude 3.5 Sonnet or GPT-4o) using LangChain's `with_structured_output` method. The LLM uses semantic reasoning to locate the materials section and returns a perfectly formatted JSON payload conforming exactly to the schema.

This ensures that the mobile application securely receives an algorithmically structured shopping list, entirely independent of the source website's unpredictable formatting.

## Conclusion

The proposed architecture represents a sophisticated amalgamation of local-first mobile paradigms, serverless cloud intelligence, and advanced procedural generation. By utilizing Ionic and RxDB for responsive on-device operations, and offloading heavy tasks like Mean Shift clustering and LangChain-driven web extraction to Firebase Cloud Functions, the system bypasses the hardware limitations of modern mobile devices. The implementation of OKLab interpolation, Bezier probability curves, and $\Delta E_{00}$ colorimetric matching ensures that digital imagery can be mathematically optimized and translated into the tactile reality of textile arts with unprecedented precision.

## Works Cited

1. MeanShift — scikit-learn 1.8.0 documentation, <https://scikit-learn.org/stable/modules/generated/sklearn.cluster.MeanShift.html>
2. `michel-leonard/ciede2000-color-matching`: The CIEDE2000 color difference formula written in 40+ programming languages — GitHub, <https://github.com/michel-leonard/ciede2000-color-matching>
3. Gradient Painter — Introduction, <https://axiomdocs.moulberry.com/tools/painting/gradientpainter.html>
