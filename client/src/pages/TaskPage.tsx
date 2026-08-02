import { useNavigate, useParams } from 'react-router';
import { TaskDetail } from '../components/TaskDetail';

// Deep-link target for notifications and emails: /todolist/task/:id renders
// the detail sheet over an empty page and returns to Today on close.
export function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const taskId = parseInt(id ?? '', 10);

  return (
    <TaskDetail
      taskId={isNaN(taskId) ? null : taskId}
      onClose={() => void navigate('/')}
      onChanged={() => {}}
    />
  );
}
