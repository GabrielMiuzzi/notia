use super::prompts::{executor_request, parse_plan, parse_review, phase_guidance, review_request, step_unfinished};
use super::tools::{list_view, new_task, resolve_task};
use super::workflow::workflow_mermaid;
use super::*;

fn task() -> AiTask {
    AiTask::new("t1".into(), "Ordenar la wiki", "Reordenar el índice del curso y encadenar nextPage/previousPage.", AiTaskOrigin::Telegram, Some(7), false, 1_000)
}

fn done(task: &mut AiTask, index: usize, report: &str) {
    task.steps[index].status = StepStatus::Done;
    task.steps[index].report = Some(report.to_string());
}

#[test]
fn the_plan_is_read_from_numbered_lines_or_bullets() {
    let steps = parse_plan("PASOS:\n1. Leer el índice — abrir Cursos/Indice.md\n2) **Reordenar** las etapas: mover la etapa 4\n3. Encadenar\n\nListo.").expect("plan");
    assert_eq!(steps.len(), 3);
    assert_eq!(steps[0], PlannedStep { title: "Leer el índice".into(), detail: "abrir Cursos/Indice.md".into() });
    assert_eq!(steps[1], PlannedStep { title: "Reordenar las etapas".into(), detail: "mover la etapa 4".into() });
    assert_eq!(steps[2].detail, "");
    let bullets = parse_plan("- Buscar - en la biblioteca\n- Escribir").expect("bullets");
    assert_eq!(bullets.len(), 2);
    assert!(parse_plan("No sé cómo hacerlo.").is_err());
    let many = (1..=40).map(|index| format!("{index}. Paso {index}")).collect::<Vec<_>>().join("\n");
    assert_eq!(parse_plan(&many).expect("many").len(), MAX_STEPS);
}

#[test]
fn the_review_verdict_steps_and_result_are_read() {
    let approved = parse_review("VEREDICTO: Aprobada\nCOMENTARIOS:\nTodo encadenado.\nRESULTADO:\nEl índice quedó en 8 etapas.");
    assert!(approved.approved && approved.steps.is_empty());
    assert_eq!(approved.feedback, "Todo encadenado.");
    assert_eq!(approved.result, "El índice quedó en 8 etapas.");

    let rework = parse_review("**Veredicto:** rehacer\nComentarios: faltan 3 documentos\nPASOS:\n1. Encadenar Return — poner nextPage\n2. Revisar Datos.md");
    assert!(!rework.approved);
    assert_eq!(rework.feedback, "faltan 3 documentos");
    assert_eq!(rework.steps.len(), 2);

    // Without a verdict line: «rehacer» in the text asks for more work.
    assert!(!parse_review("Hay que rehacer el paso 2.").approved);
    let loose = parse_review("Quedó bien.");
    assert!(loose.approved && loose.feedback == "Quedó bien.");
}

#[test]
fn the_task_plans_runs_each_step_and_reviews_until_approved() {
    let mut task = task();
    assert_eq!(task.next_work(), NextWork::Plan);
    task.set_plan(parse_plan("1. A\n2. B").expect("plan"));
    assert_eq!(task.steps.iter().map(|step| step.id.as_str()).collect::<Vec<_>>(), ["s1", "s2"]);
    assert_eq!(task.next_work(), NextWork::Execute(0));
    done(&mut task, 0, "Hice A.");
    assert_eq!(task.next_work(), NextWork::Execute(1));
    done(&mut task, 1, "Hice B.");
    assert_eq!(task.next_work(), NextWork::Review);

    let effect = task.apply_review(parse_review("VEREDICTO: rehacer\nCOMENTARIOS: falta C\nPASOS:\n1. C"), 2_000);
    assert_eq!(effect, ReviewEffect::Rework);
    assert_eq!((task.steps[2].id.as_str(), task.steps[2].round), ("s3", 1));
    assert_eq!(task.next_work(), NextWork::Execute(2));
    let request = executor_request(&task, 2);
    assert!(request.contains("La revisión pidió rehacer:\nfalta C") && request.contains("Hice A.") && request.contains("paso 3 de 3"), "{request}");
    done(&mut task, 2, "Hice C.");
    assert_eq!(task.next_work(), NextWork::Review);
    assert_eq!(task.apply_review(parse_review("VEREDICTO: aprobada\nRESULTADO: A, B y C."), 3_000), ReviewEffect::Approved);
    assert_eq!(task.result.as_deref(), Some("A, B y C."));
    assert_eq!(task.next_work(), NextWork::Done);

    // Another review asked by the agent runs once more.
    task.review_request = Some("Mirá el paso 2".into());
    assert_eq!(task.next_work(), NextWork::Review);
    assert!(review_request(&task).contains("Te piden revisar especialmente:\nMirá el paso 2"));
}

#[test]
fn a_rework_without_steps_adds_one_and_too_many_reworks_stop() {
    let mut task = task();
    task.set_plan(vec![PlannedStep { title: "A".into(), detail: String::new() }]);
    done(&mut task, 0, "ok");
    assert_eq!(task.apply_review(parse_review("VEREDICTO: rehacer\nCOMENTARIOS: mal formato"), 1), ReviewEffect::Rework);
    assert_eq!(task.steps[1].title, "Corregir lo que pidió la revisión");
    assert_eq!(task.steps[1].detail, "mal formato");
    for round in 1..MAX_REWORK_REVIEWS {
        let last = task.steps.len() - 1;
        done(&mut task, last, "ok");
        let effect = task.apply_review(parse_review("VEREDICTO: rehacer"), round as i64);
        assert_eq!(effect, if round + 1 == MAX_REWORK_REVIEWS { ReviewEffect::Exhausted } else { ReviewEffect::Rework });
    }
}

#[test]
fn the_workflow_draws_every_phase_with_its_state() {
    let mut task = task();
    assert!(workflow_mermaid(&task).contains("class plan running"));
    task.set_plan(parse_plan("1. Leer \"índice\"\n2. B").expect("plan"));
    task.status = AiTaskStatus::Running;
    task.phase = Some(AiTaskPhase::Executor);
    done(&mut task, 0, "ok");
    task.steps[1].status = StepStatus::Running;
    task.status = AiTaskStatus::AwaitingApproval;
    let graph = workflow_mermaid(&task);
    assert!(graph.starts_with("flowchart TD"));
    assert!(graph.contains("s1[\"1. Leer #quot;índice#quot;\"]") && graph.contains("plan --> s1") && graph.contains("s1 --> s2"));
    assert!(graph.contains("class s2 waiting") && graph.contains("class start,plan,s1 done"), "{graph}");

    done(&mut task, 1, "ok");
    task.apply_review(parse_review("VEREDICTO: rehacer\nPASOS:\n1. C"), 5);
    done(&mut task, 2, "ok");
    task.apply_review(parse_review("VEREDICTO: aprobada"), 6);
    task.status = AiTaskStatus::Completed;
    let graph = workflow_mermaid(&task);
    assert!(graph.contains("r1{\"Review 1\"}") && graph.contains("s2 --> r1") && graph.contains("r1 -->|rehacer| s3"), "{graph}");
    assert!(graph.contains("r2 -->|aprobada| fin") && graph.contains("fin([\"Resultado\"])"), "{graph}");
    assert!(graph.contains("class r1 rework"));
}

#[test]
fn tools_read_their_arguments_and_find_tasks() {
    assert!(new_task(&serde_json::json!({ "title": "x" })).unwrap_err().message.contains("goal"));
    let created = new_task(&serde_json::json!({ "title": " Ordenar ", "goal": "Todo" })).expect("task");
    assert_eq!(created.title, "Ordenar");
    let tasks = vec![task(), AiTask { id: "t2".into(), title: "Otra".into(), ..task() }];
    assert_eq!(resolve_task(&tasks, &serde_json::json!({ "task": "ORDENAR LA WIKI" })).expect("by title").id, "t1");
    assert_eq!(resolve_task(&tasks, &serde_json::json!({ "task": "t2" })).expect("by id").id, "t2");
    assert!(resolve_task(&tasks, &serde_json::json!({ "task": "nada" })).is_err());
    assert_eq!(list_view(&tasks)["tasks"].as_array().map(Vec::len), Some(2));
}

#[test]
fn each_phase_gets_its_format_and_reports_are_read() {
    assert!(phase_guidance(AiTaskPhase::Planner).contains("PASOS:"));
    assert!(phase_guidance(AiTaskPhase::Review).contains("VEREDICTO: aprobada | rehacer"));
    assert!(phase_guidance(AiTaskPhase::Executor).contains("NO TERMINADO:"));
    assert!(step_unfinished("**NO TERMINADO:** falta el permiso"));
    assert!(!step_unfinished("Terminé el paso."));
    assert_eq!(AiTaskStatus::from_id("awaiting-approval"), Some(AiTaskStatus::AwaitingApproval));
    assert!(AiTaskPhase::ALL.iter().all(|phase| phase.default_prompt().starts_with('#')));
}
