---
name: bts-branding
description: BTS-Synthetic brand styling for Word documents and other deliverables, using Anthropic's brand palette and typography. Use whenever producing the final proposal response, report, memo or any client-facing docx, so it looks branded and consistent. Covers colors, fonts, heading and table styling, cover block and footer.
---

# BTS-Synthetic Branding (Anthropic style)

Apply this to every client-facing document. The look is warm, editorial and uncluttered: off-white and near-black, with a single orange accent.

## Colors

| Role | Name | Hex | RGB |
| --- | --- | --- | --- |
| Primary text, dark backgrounds | Dark | `#141413` | 20, 20, 19 |
| Page and light backgrounds | Light | `#faf9f5` | 250, 249, 245 |
| Secondary text, rules, captions | Mid Gray | `#b0aea5` | 176, 174, 165 |
| Subtle fills (table banding, callouts) | Light Gray | `#e8e6dc` | 232, 230, 220 |
| Primary accent (H1, key numbers, links) | Orange | `#d97757` | 217, 119, 87 |
| Secondary accent | Blue | `#6a9bcc` | 106, 155, 204 |
| Tertiary accent | Green | `#788c5d` | 120, 140, 93 |

Rules:
- Body text is always Dark. Never pure black (`#000000`) and never accent-colored paragraphs.
- Orange is the lead accent. Use Blue and Green only for secondary distinctions, e.g. charts, status tags, or pros/cons.
- Use semantic status colors sparingly: Green = acceptable/low risk, Orange = negotiable/medium, and for blockers use Dark with bold text rather than introducing red.
- Keep the page background white or Light. Do not use full-page color fills in Word.

## Typography

- **Headings:** Poppins, fallback Arial
- **Body text:** Lora, fallback Georgia
- Do not assume the fonts are installed. Set the font names anyway (Word falls back gracefully) and name the fallback in the style where the library allows.

| Element | Font | Size | Weight | Color |
| --- | --- | --- | --- | --- |
| Title | Poppins | 28 pt | Bold | Dark |
| H1 | Poppins | 20 pt | Bold | Orange |
| H2 | Poppins | 14 pt | Bold | Dark |
| H3 | Poppins | 12 pt | Bold | Mid Gray |
| Body | Lora | 11 pt | Regular | Dark |
| Caption / footer | Lora | 9 pt | Italic | Mid Gray |

Line spacing 1.15, 6 pt after paragraphs.

## Document structure

1. **Cover block** (top of page 1, no separate cover page needed):
   - Small caps line "BTS-SYNTHETIC" in Poppins, 10 pt, Orange, letter-spaced.
   - Title (28 pt) with the customer name and "Proposal Response".
   - One-line subtitle in Mid Gray: date and RFP reference.
   - A thin Orange rule (1.5 pt) underneath.
2. **Executive summary** immediately after, as three short bullets.
3. **Sections** in the order the task requires, each starting with an H1.
4. **Footer** on every page: "BTS-Synthetic | Confidential" left, page number right, Mid Gray, 9 pt.

## Tables

- Header row: fill Dark, text Light, Poppins bold 10 pt.
- Body rows: Lora 10 pt, Dark text, alternate rows filled Light Gray.
- Borders: hairline Mid Gray horizontal rules only, no vertical lines.
- Keep tables to 5 columns or fewer. Right-align numbers.

## Callouts

For key numbers or decisions, use a single-cell table with Light Gray fill and a thick Orange left border. Keep to one or two per document.

## python-docx helpers

Use these when building the document with python-docx.

```python
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

DARK = RGBColor(0x14, 0x14, 0x13)
LIGHT = RGBColor(0xFA, 0xF9, 0xF5)
MID_GRAY = RGBColor(0xB0, 0xAE, 0xA5)
ORANGE = RGBColor(0xD9, 0x77, 0x57)
BLUE = RGBColor(0x6A, 0x9B, 0xCC)
GREEN = RGBColor(0x78, 0x8C, 0x5D)
LIGHT_GRAY_HEX = "E8E6DC"
DARK_HEX = "141413"


def set_font(style, name, size, color, bold=False, italic=False):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.italic = italic
    style.font.color.rgb = color
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), name)


def apply_brand_styles(doc: Document) -> None:
    styles = doc.styles
    set_font(styles["Normal"], "Lora", 11, DARK)
    set_font(styles["Title"], "Poppins", 28, DARK, bold=True)
    set_font(styles["Heading 1"], "Poppins", 20, ORANGE, bold=True)
    set_font(styles["Heading 2"], "Poppins", 14, DARK, bold=True)
    set_font(styles["Heading 3"], "Poppins", 12, MID_GRAY, bold=True)
    styles["Normal"].paragraph_format.line_spacing = 1.15
    styles["Normal"].paragraph_format.space_after = Pt(6)


def shade_cell(cell, hex_fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def style_table(table) -> None:
    for i, row in enumerate(table.rows):
        for cell in row.cells:
            if i == 0:
                shade_cell(cell, DARK_HEX)
            elif i % 2 == 0:
                shade_cell(cell, LIGHT_GRAY_HEX)
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(10)
                    run.font.name = "Poppins" if i == 0 else "Lora"
                    run.font.bold = i == 0
                    run.font.color.rgb = LIGHT if i == 0 else DARK
```

## Customer delight: make the RFP response feel written for this customer

Apply this to every proposal response. The goal is that the evaluator can score us from our document alone, and feels we read their RFP closely. All elements must live inside the docx. Do not mention microsites, calculators or anything that needs a browser.

Where these rules conflict with "Callouts" or "Tables" above, these rules win for the elements named here. The palette, fonts and the "Do and don't" list still apply.

### Source discipline

- Every number, name and date comes from the RFP, the specialists' replies or the supporting files. Never invent figures, references, customer names or quotes.
- If a requested element has no data behind it (for example reference customers), build the slot and mark it "To be confirmed by the account team" in Mid Gray italics. Do not fabricate.
- Anything illustrative (charts built from assumptions) carries a caption saying so and naming the assumptions.

### Document flow

Use this order unless the task says otherwise. Order follows the customer's evaluation criteria, not our internal structure.

1. Cover block with a hero stat row (see below).
2. One-page executive summary. It must stand alone and fit on a single page: three bullets, a "Why us" line, and one clear next step with a date.
3. "What we heard": the customer's needs in their own words.
4. "How we score against your criteria": the evaluation heatmap.
5. Sections in the order of the customer's evaluation criteria, highest weight first. Name each H1 after the criterion and show its weight, for example "Functional fit (30%)".
6. Requirements traceability matrix.
7. Architecture diagram, TCO chart and migration timeline, placed inside the sections they support.
8. "Where we say yes, where we hold".
9. Reference cards.
10. Appendix: assumptions and open items.

If the RFP states a different response format, follow the RFP and fit these elements inside it.

### 1. Hero stat row (cover)

One row of three or four numbers from the RFP, placed under the cover rule. Build it as a single-row table with no borders. Each cell has a large number (Poppins bold, 24 pt, Orange) over a one-line label (Lora 9 pt, Mid Gray). Choose the stats the customer cares most about, such as data volume, peak throughput, user count, countries. This is the one place a stat row replaces a callout.

### 2. "What we heard"

A short page quoting the customer's own requirements with their wording, for example the non-negotiables, the scale figures and the stated deadlines. Format: two columns, left "You said" in Lora italic with the RFP section reference, right "Our answer" in one sentence with a pointer to the section that covers it. Keep to 6 to 8 rows. Quote exactly. Do not paraphrase into marketing language.

### 3. Evaluation heatmap

A table with one row per evaluation criterion from the RFP, with columns: Criterion, Weight, Our position, Evidence (a pointer to the section). Colour only the "Our position" cell using the status colours already in this skill: Green fill for strong, Light Gray with an Orange left border for partial or conditional, Dark fill with Light bold text for a gap we are honest about. Always add a text label as well as colour, for example "Strong", "Partial", "Gap", so it works in black and white print. Show the weights exactly as the customer gave them. Do not recompute or reweight.

### 4. Requirements traceability matrix

One row per requirement or clause in the RFP that we must answer. Columns (five at most): RFP ref, Requirement, Status, Our response, Section. Status is a text chip, one of: Meets, Partial, Negotiable, Counter-proposal. Style the chip as bold Poppins 9 pt with the same colour logic as the heatmap. Group rows under the RFP's own section headings. If the RFP mentions a separate capability matrix attachment, say that this table is the in-document equivalent and that the attachment follows separately. Do not fabricate the attachment.

### 5. Architecture diagram

Include one diagram as an embedded PNG that traces the customer's own data path from source to consumer, labelled with their real numbers (device counts, throughput, volumes, regions, tools they named). Mark any residency or compliance boundary they care about as a labelled dashed box. If they are migrating off a legacy system, show it as a separate lane with its decommission date.

Build it with matplotlib or a similar library in the container, using only the brand palette (Dark lines and text, Light Gray boxes, Orange for the one path or component that matters most, Blue for secondary flows). Render at 200 dpi, width 6.5 inches, with a text caption underneath in the caption style. Always add alt text. If no plotting library is available, build the diagram as a table of boxes and arrows using text.

### 6. Five-year cost chart

If the RFP asks for multi-year pricing, include one chart of cost over the full horizon, built only from the Pricing Specialist's numbers. Show the ramp or phasing, and mark the customer's stated constraints (for example a required discount or "no escalators") as labelled lines or annotations. Follow the same chart rules as the diagram. A table of the same numbers goes directly below, right-aligned. State every assumption in the caption. This is a static chart: never describe it as a calculator.

### 7. Migration and delivery timeline

A simple Gantt-style chart or table anchored on dates from the RFP (award date, legacy decommission date). Use phases and milestones from the implementation plan only. Include a "first 100 days" strip with three to five concrete outcomes. Mark the dates that depend on the customer in Blue so the evaluator sees shared responsibility.

### 8. "Where we say yes, where we hold"

Replace any defensive-sounding contract section with this page. Open with one sentence stating that we accept the large majority of the customer's terms. Then a table: Clause, What you asked, What we propose, Why. Rules:

- Lead with what we accept. List acceptable items first.
- For every item we do not accept as written, give a concrete counter-proposal and a one-sentence reason in the customer's interest. Never just say no.
- Use the Legal Reviewer's positions exactly. Do not soften or strengthen them, and do not invent concessions.
- Keep the tone collaborative: "we propose" and "to protect both parties", not "we refuse".
- Label severity in text, using the status colours above. Blockers use Dark bold, not red.

### 9. Audience paths

State on the first page who the document is for and offer reading paths in one short line each, for example "Procurement: sections X, Y, Z" and "Technical leadership: sections A, B". Use the real names and titles from the RFP's contact section when given. Cross-reference by section name.

### 10. Reference cards

If the RFP asks for references, show each as a card: a single-row, three-cell table with Light Gray fill. It carries the customer descriptor, the matching attributes the RFP asked for (scale, platform, tools), and one headline metric. Only use references supplied in the input data. If there are none, build the cards with "To be confirmed by the account team".

### 11. Competitive framing

Never name or criticise competitors in a customer-facing document. Use the Competitive Intel Analyst's work to shape the content, for example by emphasising our differentiators in the evaluation heatmap, but keep the analysis internal. Offer the customer a short "Questions worth asking every vendor" box only if the analyst's brief supports it, and keep it factual and neutral.

### 12. Optional forward-looking page

If the RFP mentions a planned future workload (for example machine learning "planned, not active"), add one half-page on what the customer could do with it on the proposed platform. Use only capabilities listed in the product overview, label it "Looking ahead", and do not promise delivery dates or outcomes.

### Visual polish rules

- Use at most one image per page, and one big idea per page.
- Every table has a one-line caption above it saying what it shows.
- Use real Word headings so the navigation pane and table of contents work. Add a table of contents when the document exceeds six pages.
- Set alt text on every image.
- Start each H1 on a new page only for the executive summary, the matrix and the appendix. Elsewhere keep flow continuous.
- Keep the whole document readable in black and white: never rely on colour alone.

### Final check for delight

Before finishing, confirm: the executive summary fits one page and stands alone; the heatmap uses the customer's exact weights; every RFP requirement appears in the matrix; every figure traces to the input; the contract page leads with acceptance and gives a counter for every exception; no competitor is named; and nothing in the document is invented.

## Do and don't

- Do keep generous white space and short paragraphs. The tone is confident and plain.
- Do use one accent color per element.
- Don't use drop shadows, gradients, clip art or emoji.
- Don't use more than three colors on a single page besides Dark, Light and the grays.
- Don't invent a different brand name. The firm is BTS-Synthetic.

## Before finishing

Check that: headings use Poppins and body uses Lora, H1s are Orange, text is Dark rather than black, tables follow the header and banding rules, and the footer shows on every page.
