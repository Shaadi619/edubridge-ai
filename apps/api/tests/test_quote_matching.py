from app.ai.contracts import EvidenceChunk, EvidenceQuote
from app.ai.evidence import find_quote, quoted_chunks

# Text as PDF extraction stores it for Lecture 7 (SVM): maths letters, minus signs, dot operators.
SVM_PAGE = (
    "2.1 The decision function (slides 13, 15) 𝑓(𝐱)=𝐰⋅𝐱+𝑏=𝑤1𝑥1 +𝑤2𝑥2 +𝑏 "
    "The score 𝑓(𝐱) tells us the side, but not the distance: 𝑥1 −2=0 and 10𝑥1 −20=0 "
    "are the same line, yet the second gives scores ten times larger. Dividing by ∥𝐰∥ fixes this. "
    "Our two lines in this form: line A is 𝑥1 −𝑥2 −2=0, so 𝐰=(1,−1), 𝑏=−2."
)


def test_plain_typed_quote_matches_pdf_maths_and_returns_the_page_text() -> None:
    found = find_quote("The score f(x) tells us the side, but not the distance", SVM_PAGE)
    assert found == "The score 𝑓(𝐱) tells us the side, but not the distance"


def test_minus_signs_dots_and_spacing_are_treated_as_equal() -> None:
    assert find_quote("line A is x1 - x2 - 2 = 0, so w = (1, -1), b = -2", SVM_PAGE) == \
        "line A is 𝑥1 −𝑥2 −2=0, so 𝐰=(1,−1), 𝑏=−2"
    assert find_quote("f(x) = w·x + b = w1x1 + w2x2 + b", SVM_PAGE) == "𝑓(𝐱)=𝐰⋅𝐱+𝑏=𝑤1𝑥1 +𝑤2𝑥2 +𝑏"


def test_curly_quotes_and_case_do_not_matter() -> None:
    page = "The SVM picks the line with the widest gap to both classes."
    assert find_quote("the svm picks the line with the widest gap", page) == "The SVM picks the line with the widest gap"


def test_quotes_that_are_not_in_the_text_or_too_short_are_rejected() -> None:
    assert find_quote("The SVM always picks the first line that works", SVM_PAGE) is None
    assert find_quote("𝑏=−2", SVM_PAGE) is None
    assert find_quote("   ", SVM_PAGE) is None


def test_quoted_chunks_accepts_maths_quotes() -> None:
    chunk = EvidenceChunk(chunk_id="c7", document_id="d7", document_title="Lecture_07_SVM_Explained.pdf",
                          page_number=4, content=SVM_PAGE)
    matched = quoted_chunks([EvidenceQuote(chunk_id="c7", quote="Dividing by ||w|| fixes this")], {"c7": chunk})
    assert matched == []  # "||" is not the norm symbol, so this must not match
    matched = quoted_chunks([EvidenceQuote(chunk_id="c7", quote="yet the second gives scores ten times larger")], {"c7": chunk})
    assert [item.chunk_id for item in matched] == ["c7"]
