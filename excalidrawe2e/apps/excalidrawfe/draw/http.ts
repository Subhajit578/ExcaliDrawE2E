import axios from "axios";
type ShapeRow = {
    id: number;
    type: string;
    data: any; 
    roomId: number;
    userId: string;
  };
export async function getExistingShapes(roomId: string) {
    const token = localStorage.getItem("token")
    const res = await axios.get(`http://localhost:3001/shapes/${roomId}`, {headers : {
        Authorization : `Bearer ${token}`
    }});
    const shapes:ShapeRow[] = res.data.shapes;


    return shapes.map(s => ({
        type:s.type,  ...s.data
    }));
}