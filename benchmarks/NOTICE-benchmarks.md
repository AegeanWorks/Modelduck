# Third-party benchmark items

`benchmarks/public-items.mjs` contains 60 items taken from public datasets. Each
item records its dataset, original id and license in its `source` field.

| Dataset | Source | License | Items | Changes |
|---|---|---|---:|---|
| GSM8K | [openai/gsm8k](https://huggingface.co/datasets/openai/gsm8k), test split | MIT, © OpenAI | 16 | Whitespace normalised; reasoning plus "Answer: <number>" requested; one "How load" typo corrected to "How long"; 512-token reply budget |
| MMLU | [cais/mmlu](https://huggingface.co/datasets/cais/mmlu), test split | MIT, © Hendrycks et al. | 12 | Formatted as lettered choices; the Unicode minus is written as "-" |
| HumanEval | [openai/openai_humaneval](https://huggingface.co/datasets/openai/openai_humaneval) | MIT, © OpenAI | 12 | Task descriptions translated from Python docstrings to JavaScript; test cases taken from the original `check` functions; float cases chosen to be exact in JavaScript |
| MBPP (sanitized) | [google-research-datasets/mbpp](https://huggingface.co/datasets/google-research-datasets/mbpp), test split | CC BY 4.0, © Google LLC | 8 | Translated to JavaScript with the original asserts; function names converted to camelCase |
| TruthfulQA | [truthfulqa/truthful_qa](https://huggingface.co/datasets/truthfulqa/truthful_qa), multiple_choice validation, mc1 | Apache-2.0, © Lin, Hilton, Evans | 12 | Choices rotated by item position |

The MIT licenses require this notice and the copyright lines above to be kept with
the copied material. CC BY 4.0 requires attribution and an indication of changes,
which the table gives. Public benchmark items may appear in models' training data,
so results for the `public-*` categories are reported separately from the private
items written for ModelDuck.
