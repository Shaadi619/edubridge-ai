from app.routers.materials import storage_path_in_course
from app.routers.voice import MAX_AUDIO_BYTES, AudioTranscriptionRequest
from app.routers.work_analysis import MAX_WORK_BYTES, WorkSubmissionRequest

COURSE = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


def test_material_path_must_sit_in_its_own_course() -> None:
    assert storage_path_in_course(f"{COURSE}/teacher/file.pdf", COURSE)
    assert not storage_path_in_course(f"{OTHER}/teacher/file.pdf", COURSE)
    assert not storage_path_in_course(f"{COURSE}/../{OTHER}/file.pdf", COURSE)
    assert not storage_path_in_course(f"/{COURSE}/file.pdf", COURSE)
    assert not storage_path_in_course(f"{COURSE}//file.pdf", COURSE)
    assert not storage_path_in_course("file.pdf", COURSE)


def test_upload_bodies_are_capped_before_decoding() -> None:
    for model, limit in ((WorkSubmissionRequest, MAX_WORK_BYTES), (AudioTranscriptionRequest, MAX_AUDIO_BYTES)):
        field = model.model_fields["data_base64"]
        allowed = next(rule.max_length for rule in field.metadata if hasattr(rule, "max_length"))
        assert limit * 4 / 3 <= allowed < limit * 4 / 3 + 8
